import type { LiveEvent } from "../db/schema";
import { CreatorRepository } from "../repositories/creator.repository";
import { LiveRepository } from "../repositories/live.repository";
import { ConfigService } from "./config.service";
import { badRequest, forbidden, notFound, unprocessable } from "./errors";
import { minLivePrice, validateLivePrice } from "./pricing";

export interface ScheduleLiveInput {
  title?: string;
  description?: string;
  declaredDurationMin: number;
  ticketPriceUgx: number;
  scheduledStartAt?: number; // unix seconds
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

    const cfg = await this.config.pricingConfig();
    const check = validateLivePrice(input.ticketPriceUgx, input.declaredDurationMin, cfg);
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
      status: "scheduled",
      scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt * 1000) : null,
    });
  }

  /** Preview the §3.3 floor for a duration without creating anything (UI helper). */
  async quoteFloor(declaredDurationMin: number): Promise<{ floor: number }> {
    if (!Number.isInteger(declaredDurationMin) || declaredDurationMin <= 0) {
      throw badRequest("bad_duration", "declaredDurationMin must be a positive integer");
    }
    const cfg = await this.config.pricingConfig();
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
    return this.setStatusChecked(id, "live", { startedAt: new Date() });
  }

  async end(id: string, userId: string): Promise<LiveEvent> {
    const event = await this.requireOwnedEvent(id, userId);
    if (event.status !== "live") {
      throw badRequest("bad_state", `cannot end a ${event.status} event`);
    }
    return this.setStatusChecked(id, "ended", { endedAt: new Date() });
  }

  private async setStatusChecked(
    id: string,
    status: LiveEvent["status"],
    patch: Partial<LiveEvent>,
  ): Promise<LiveEvent> {
    const updated = await this.live.setStatus(id, status, patch);
    if (!updated) throw notFound("live event");
    return updated;
  }

  async get(id: string): Promise<LiveEvent> {
    const event = await this.live.findById(id);
    if (!event) throw notFound("live event");
    return event;
  }

  listByCreator(creatorId: string): Promise<LiveEvent[]> {
    return this.live.listByCreator(creatorId);
  }
}
