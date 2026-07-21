import type { Content } from "../db/schema";
import { ContentRepository } from "../repositories/content.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { EntitlementRepository } from "../repositories/entitlement.repository";
import { ConfigService } from "./config.service";
import { badRequest, forbidden, notFound, unprocessable } from "./errors";
import { validateRecordedPrice } from "./pricing";
import { StorageService } from "./storage/storage.service";

export interface CreateContentInput {
  kind?: "video" | "photo";
  title?: string;
  description?: string;
  r2Key?: string;
  thumbnailR2Key?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  pricing?: "free" | "paid";
  priceUgx?: number;
}

export interface UpdateContentInput {
  title?: string;
  description?: string;
  pricing?: "free" | "paid";
  priceUgx?: number;
}

/**
 * ContentService — recorded content lifecycle (§4.5). Enforces the recorded
 * price floor (§3.2) on paid items and the clip-length cap (§4.3). Ownership is
 * checked against the acting user's creator profile.
 */
export class ContentService {
  constructor(
    private readonly content: ContentRepository,
    private readonly creators: CreatorRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private async requireOwnedContent(id: string, userId: string): Promise<Content> {
    const item = await this.content.findById(id);
    if (!item || item.status === "deleted") throw notFound("content");
    const creator = await this.creators.findById(item.creatorId);
    if (!creator || creator.userId !== userId) throw forbidden("not your content");
    return item;
  }

  private async requireCreatorId(userId: string): Promise<string> {
    const creator = await this.creators.findByUserId(userId);
    if (!creator) {
      throw forbidden("become a creator before uploading content");
    }
    if (creator.status !== "active") {
      throw forbidden(`creator account is ${creator.status}`);
    }
    return creator.id;
  }

  async create(userId: string, input: CreateContentInput): Promise<Content> {
    const creatorId = await this.requireCreatorId(userId);
    const pricing = input.pricing ?? "free";

    if (input.durationSeconds != null) {
      const cap = await this.config.clipMaxLengthSeconds();
      if (input.durationSeconds > cap) {
        throw unprocessable(
          "clip_too_long",
          `Clip exceeds the ${cap}s maximum length`,
          { maxSeconds: cap },
        );
      }
    }

    let priceUgx: number | null = null;
    if (pricing === "paid") {
      priceUgx = await this.validatePaidPrice(input.priceUgx);
    }

    return this.content.create({
      creatorId,
      kind: input.kind ?? "video",
      title: input.title,
      description: input.description,
      r2Key: input.r2Key,
      thumbnailR2Key: input.thumbnailR2Key,
      durationSeconds: input.durationSeconds,
      sizeBytes: input.sizeBytes,
      pricing,
      priceUgx,
      status: "draft",
    });
  }

  private async validatePaidPrice(priceUgx: number | undefined): Promise<number> {
    if (priceUgx == null || !Number.isInteger(priceUgx)) {
      throw badRequest("price_required", "Paid content needs an integer priceUgx");
    }
    const cfg = await this.config.pricingConfig();
    const check = validateRecordedPrice(priceUgx, cfg);
    if (!check.ok) {
      throw unprocessable(
        "below_price_floor",
        `Price must be at least ${check.floor} UGX`,
        { floor: check.floor },
      );
    }
    return priceUgx;
  }

  async update(
    id: string,
    userId: string,
    input: UpdateContentInput,
  ): Promise<Content> {
    const item = await this.requireOwnedContent(id, userId);
    const patch: Partial<Content> = {};

    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;

    // Pricing status change (§4.5.1). Note: already-distributed copies are not
    // recalled (free→paid) and existing buyers keep access (paid→free); the app
    // surfaces those warnings — the API simply applies the new status forward.
    const nextPricing = input.pricing ?? item.pricing;
    if (nextPricing === "paid") {
      patch.pricing = "paid";
      patch.priceUgx = await this.validatePaidPrice(input.priceUgx ?? item.priceUgx ?? undefined);
    } else if (nextPricing === "free") {
      patch.pricing = "free";
      patch.priceUgx = null;
    }

    return this.content.update(id, patch);
  }

  async publish(id: string, userId: string): Promise<Content> {
    await this.requireOwnedContent(id, userId);
    return this.content.setStatus(id, "published", { publishedAt: new Date() });
  }

  /** Archive / unpublish — reversible; buyers keep access (§4.5.5). */
  async archive(id: string, userId: string): Promise<Content> {
    await this.requireOwnedContent(id, userId);
    return this.content.setStatus(id, "archived");
  }

  async unarchive(id: string, userId: string): Promise<Content> {
    await this.requireOwnedContent(id, userId);
    return this.content.setStatus(id, "published");
  }

  /**
   * Hard-delete (§4.5.5): media is gone and buyers' entitlements are revoked,
   * but the financial ledger is retained (never touched here).
   */
  async hardDelete(id: string, userId: string): Promise<{ deleted: true }> {
    const item = await this.requireOwnedContent(id, userId);
    const now = new Date();
    await this.entitlements.revokeForContent(item.id, now);
    await this.content.setStatus(id, "deleted", { deletedAt: now });
    // Purge the media bytes from R2 (§4.5.5 — delete the media, keep the ledger).
    const keys = [item.r2Key, item.thumbnailR2Key].filter((k): k is string => !!k);
    if (keys.length) await this.storage.delete(keys);
    return { deleted: true };
  }

  async listPublishedByCreator(creatorId: string): Promise<Content[]> {
    return this.content.listPublishedByCreator(creatorId);
  }

  async getForViewer(id: string): Promise<Content> {
    const item = await this.content.findById(id);
    if (!item || item.status === "deleted") throw notFound("content");
    return item;
  }

  /**
   * Global feed (newest published first) with simple time cursor. When a
   * signed-in viewer is known, each paid item is decorated with `owned` so the
   * client can render it unlocked immediately (no lock flash after restart).
   */
  async feed(limit = 20, beforeSec?: number, viewerUserId?: string | null) {
    const cap = Math.min(Math.max(limit, 1), 50);
    const items = await this.content.listFeed(
      cap,
      beforeSec ? new Date(beforeSec * 1000) : undefined,
    );
    if (!viewerUserId) return items.map((it) => ({ ...it, owned: false }));

    const paidIds = items.filter((it) => it.pricing === "paid").map((it) => it.id);
    const ownedIds = await this.entitlements.listActiveContentIds(viewerUserId, paidIds);
    return items.map((it) => ({ ...it, owned: ownedIds.has(it.id) }));
  }

  // --- Media (R2) ---------------------------------------------------------

  /** Upload/replace the primary media object for a content item (§2.2). */
  async attachMedia(
    id: string,
    userId: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<Content> {
    const item = await this.requireOwnedContent(id, userId);
    const key = this.storage.mediaKey(id);
    const { size } = await this.storage.put(key, body, contentType);
    const updated = await this.content.update(id, { r2Key: key, sizeBytes: size });
    // Replace: drop the previous object, if any.
    if (item.r2Key && item.r2Key !== key) await this.storage.delete(item.r2Key);
    return updated;
  }

  /** Upload/replace the thumbnail object. */
  async attachThumbnail(
    id: string,
    userId: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<Content> {
    const item = await this.requireOwnedContent(id, userId);
    const key = this.storage.thumbnailKey(id);
    await this.storage.put(key, body, contentType);
    const updated = await this.content.update(id, { thumbnailR2Key: key });
    if (item.thumbnailR2Key && item.thumbnailR2Key !== key) {
      await this.storage.delete(item.thumbnailR2Key);
    }
    return updated;
  }

  /**
   * Open the media object for a viewer, enforcing access (§4.4/§4.5):
   *  - the owning creator always has access;
   *  - otherwise the item must be published;
   *  - free → open (public download, §4.4); paid → requires an active
   *    entitlement (the buyer's purchase, §3.1).
   * `userId` may be null for anonymous requests to free content.
   */
  async openMedia(
    id: string,
    userId: string | null,
    range?: R2Range,
  ): Promise<{ object: R2ObjectBody; content: Content }> {
    const item = await this.content.findById(id);
    if (!item || item.status === "deleted") throw notFound("content");

    await this.authorizeMedia(item, userId);

    if (!item.r2Key) throw notFound("media");
    const object = await this.storage.get(item.r2Key, range);
    if (!object) throw notFound("media");
    return { object, content: item };
  }

  private async authorizeMedia(item: Content, userId: string | null): Promise<void> {
    if (userId) {
      const creator = await this.creators.findById(item.creatorId);
      if (creator && creator.userId === userId) return; // owner
    }
    if (item.status !== "published") throw forbidden("content is not available");
    if (item.pricing === "free") return;

    // Paid: require an active entitlement.
    if (!userId) throw forbidden("purchase required");
    const ent = await this.entitlements.findActive(userId, "contentId", item.id);
    if (!ent) throw forbidden("purchase required");
  }
}
