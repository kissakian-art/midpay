import type { LiveEvent } from "../db/schema";
import { CreatorRepository } from "../repositories/creator.repository";
import { EntitlementRepository } from "../repositories/entitlement.repository";
import { LiveRepository, type LiveEventWithCreator } from "../repositories/live.repository";
import { ConfigService } from "./config.service";
import { badRequest, forbidden, notFound, unprocessable } from "./errors";
import { minLivePrice } from "./pricing";
import { UserRepository } from "../repositories/user.repository";
import { LiveShutdownService } from "./live-shutdown.service";
import { quotePolicy } from "./live-price-policy";

export interface ScheduleLiveInput {
  title?: string;
  description?: string;
  declaredDurationMin: number;
  ticketPriceUgx: number;
  scheduledStartAt?: number; // unix seconds
}

/** A live event with the viewer's access flags resolved for the UI. */
export interface LiveEventForViewer extends LiveEventWithCreator {
  /** The caller already holds a ticket (or is the broadcaster). */
  owned: boolean;
  /** The caller is the creator of this event. */
  isOwner: boolean;
}

/**
 * LiveService — scheduling & lifecycle for live broadcasts (§4.2), enforcing
 * the §3.3 Live Duration-Based Price Floor at schedule time (server-side, a
 * hard requirement). The applied floor is snapshotted onto the event.
 */
export class LiveService {
  constructor(
    private readonly live: LiveRepository,
    private readonly creators: CreatorRepository,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementRepository,
    private readonly users: UserRepository,
    private readonly shutdown: LiveShutdownService,
  ) {}

  private async requireActiveCreatorId(userId: string): Promise<string> {
    const creator = await this.creators.findByUserId(userId);
    if (!creator) throw forbidden("become a creator before scheduling a live");
    if (creator.status !== "active") throw forbidden(`creator account is ${creator.status}`);
    return creator.id;
  }

  async schedule(userId: string, input: ScheduleLiveInput): Promise<LiveEvent> {
    const creatorId = await this.requireActiveCreatorId(userId);

    if (!Number.isInteger(input.declaredDurationMin) || input.declaredDurationMin <= 0) {
      throw badRequest("bad_duration", "declaredDurationMin must be a positive integer");
    }
    if (!Number.isInteger(input.ticketPriceUgx) || input.ticketPriceUgx <= 0) {
      throw badRequest("bad_price", "ticketPriceUgx must be a positive integer");
    }

    const creator = await this.creators.findById(creatorId);
    const creatorSplitBps = creator?.liveSplitBpsOverride ?? 6000;
    if (!Number.isSafeInteger(creatorSplitBps) || creatorSplitBps < 0 || creatorSplitBps >= 10000) throw badRequest("invalid_split", "Creator share must leave a platform share");
    const { floor } = await this.quoteFloor(input.declaredDurationMin, (creator?.liveSplitBpsOverride ?? 7000) / 100);
    const check = { floor, ok: input.ticketPriceUgx >= floor };
    if (!check.ok) {
      // §3.3 hard block: ticket below the duration-scaled floor is rejected.
      throw unprocessable(
        "below_live_price_floor",
        `Ticket must be at least ${check.floor} UGX for a ${input.declaredDurationMin}-minute live`,
        { floor: check.floor, declaredDurationMin: input.declaredDurationMin },
      );
    }

    return this.live.create({
      creatorId,
      title: input.title,
      description: input.description,
      declaredDurationMin: input.declaredDurationMin,
      ticketPriceUgx: input.ticketPriceUgx,
      priceFloorAppliedUgx: check.floor,
      creatorSplitBps,
      status: "scheduled",
      scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt * 1000) : null,
    });
  }

  /** Preview the §3.3 floor for a duration without creating anything (UI helper). */
  async quoteForViewer(declaredDurationMin: number, userId: string | null) {
    const creator = userId ? await this.creators.findByUserId(userId) : undefined;
    return this.quoteFloor(declaredDurationMin, (creator?.liveSplitBpsOverride ?? 7000) / 100);
  }

  async quoteFloor(declaredDurationMin: number, creatorPercent = 70): Promise<{ floor: number }> {
    if (!Number.isInteger(declaredDurationMin) || declaredDurationMin <= 0) {
      throw badRequest("bad_duration", "declaredDurationMin must be a positive integer");
    }
    const cfg = await this.config.pricingConfig();
    const policy = await this.config.livePricePolicy();
    if (policy) {
      // Never budget below the current collection fee or allowed live grace.
      return { floor: quotePolicy({ ...policy, collectionPercent: Math.max(policy.collectionPercent, cfg.flutterwaveFeePercent),
        graceMinutes: Math.max(policy.graceMinutes, await this.config.liveGraceMinutes()) }, declaredDurationMin, creatorPercent).floor };
    }
    return { floor: minLivePrice(declaredDurationMin, cfg) };
  }

  private async requireOwnedEvent(id: string, userId: string): Promise<LiveEvent> {
    const event = await this.live.findById(id);
    if (!event) throw notFound("live event");
    const creator = await this.creators.findById(event.creatorId);
    if (!creator || creator.userId !== userId) throw forbidden("not your live event");
    return event;
  }

  async start(id: string, userId: string): Promise<LiveEvent> {
    const event = await this.requireOwnedEvent(id, userId);
    if (event.status !== "scheduled") {
      throw badRequest("bad_state", `cannot start a ${event.status} event`);
    }
    const updated = await this.live.startOwned(id, userId);
    if (!updated) throw forbidden("Live event or creator is no longer available");
    return updated;
  }

  async end(id: string, userId: string): Promise<LiveEvent> {
    const event = await this.requireOwnedEvent(id, userId);
    if (event.status === "ended" || event.status === "terminated") {
      await this.shutdown.close(id);
      return (await this.live.findById(id))!;
    }
    if (event.status !== "live") {
      throw badRequest("bad_state", `cannot end a ${event.status} event`);
    }
    await this.live.finish(id, "ended");
    await this.shutdown.close(id);
    return (await this.live.findById(id))!;
  }

  /** Shared by video grants and chat (including a second check inside the DO). */
  async requireAccess(id: string, userId: string): Promise<LiveEventForViewer> {
    const event = await this.getForViewer(id, userId);
    if (event.status !== "live" || !event.startedAt) throw forbidden("Live event is not broadcasting");
    const deadline = event.startedAt.getTime() + (event.declaredDurationMin + await this.config.liveGraceMinutes()) * 60000;
    if (Date.now() >= deadline) throw forbidden("Live event has reached its time limit");
    const [creator, user, owner] = await Promise.all([
      this.creators.findById(event.creatorId), this.users.findById(userId), this.users.findById(event.creatorUserId),
    ]);
    if (creator?.status !== "active" || user?.status !== "active" || owner?.status !== "active") throw forbidden("Account unavailable");
    if (!event.owned) throw forbidden("Buy a ticket to join this live");
    return event;
  }

  async get(id: string): Promise<LiveEvent> {
    const event = await this.live.findById(id);
    if (!event) throw notFound("live event");
    return event;
  }

  /** Everyone currently broadcasting — the discovery surface (public). */
  listActive(): Promise<LiveEventWithCreator[]> {
    return this.live.listLiveWithCreator();
  }

  /**
   * Fetch an event with the caller's access flags resolved. The broadcaster
   * always "owns" their own event; any other viewer owns it once they hold an
   * active ticket entitlement. Anonymous callers (userId null) never own it.
   */
  async getForViewer(id: string, userId: string | null): Promise<LiveEventForViewer> {
    const event = await this.live.findByIdWithCreator(id);
    if (!event) throw notFound("live event");
    const isOwner = !!userId && event.creatorUserId === userId;
    const owned =
      isOwner ||
      (!!userId && !!(await this.entitlements.findActive(userId, "liveEventId", id)));
    return { ...event, owned, isOwner };
  }

  listByCreator(creatorId: string): Promise<LiveEvent[]> {
    return this.live.listByCreator(creatorId);
  }
}
