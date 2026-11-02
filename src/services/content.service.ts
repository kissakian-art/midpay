import type { Content, TextOverlay, TextStyle } from "../db/schema";
import { ContentRepository } from "../repositories/content.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { EntitlementRepository } from "../repositories/entitlement.repository";
import { ConfigService } from "./config.service";
import { badRequest, forbidden, notFound, unprocessable } from "./errors";
import { validateRecordedPrice } from "./pricing";
import { StorageService } from "./storage/storage.service";
import { contentView } from "./content-view";
import { validateImageUpload } from "./image-upload";

export interface CreateContentInput {
  kind?: "video" | "photo" | "text";
  title?: string;
  description?: string;
  r2Key?: string;
  thumbnailR2Key?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  pricing?: "free" | "paid";
  priceUgx?: number;
  overlays?: TextOverlay[] | null;
  textStyle?: TextStyle | null;
  musicTrackId?: string | null;
  musicStartMs?: number | null;
  musicEndMs?: number | null;
  musicVolume?: number | null; // 0..100, playback loudness of the music
}

export interface UpdateContentInput {
  title?: string;
  description?: string;
  pricing?: "free" | "paid";
  priceUgx?: number;
  overlays?: TextOverlay[] | null;
  textStyle?: TextStyle | null;
  musicTrackId?: string | null;
  musicStartMs?: number | null;
  musicEndMs?: number | null;
  musicVolume?: number | null;
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
    if (creator.status !== "active") throw forbidden("Creator account is unavailable");
    if (item.status === "quarantined") throw forbidden("Content is under moderation review");
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
    if (input.r2Key !== undefined || input.thumbnailR2Key !== undefined) {
      throw badRequest("storage_key_forbidden", "Upload media through the content upload endpoints");
    }
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
      priceUgx = await this.validatePaidPrice(input.priceUgx, input.kind ?? "video");
    } else if (input.durationSeconds != null) {
      // Free video → counts against the creator's free-minutes allowance.
      await this.assertFreeMinutesAllows(creatorId, input.durationSeconds);
    }

    return this.content.create({
      creatorId,
      kind: input.kind ?? "video",
      title: input.title,
      description: input.description,
      durationSeconds: input.durationSeconds,
      sizeBytes: input.sizeBytes,
      pricing,
      priceUgx,
      overlays: input.overlays ?? null,
      textStyle: input.textStyle ?? null,
      musicTrackId: input.musicTrackId ?? null,
      musicStartMs: input.musicStartMs ?? null,
      musicEndMs: input.musicEndMs ?? null,
      musicVolume: input.musicVolume ?? null,
      status: "draft",
    });
  }

  /**
   * §4.5.3 free-video allowance: a creator's total FREE video minutes are
   * capped (paid videos are unlimited). Throws if adding `addSeconds` of free
   * video would exceed the cap. Photos/text (no duration) never consume it.
   */
  private async assertFreeMinutesAllows(creatorId: string, addSeconds: number): Promise<void> {
    if (!addSeconds || addSeconds <= 0) return;
    const limitMin = await this.config.freeContentMinutes();
    if (limitMin <= 0) return; // 0 = disabled (unlimited free)
    const limitSec = limitMin * 60;
    const usedSec = await this.content.sumFreeVideoSeconds(creatorId);
    if (usedSec + addSeconds > limitSec) {
      throw unprocessable(
        "free_minutes_exhausted",
        `Free videos are capped at ${limitMin} minutes per creator (you've used ${Math.round(
          usedSec / 60,
        )} min). Make this a paid video, or remove some free ones.`,
        {
          limitMinutes: limitMin,
          usedSeconds: usedSec,
          remainingSeconds: Math.max(0, limitSec - usedSec),
          addSeconds,
        },
      );
    }
  }

  /** Paid price floor for a content kind — photos get their own lower floor. */
  private async priceFloorFor(kind: "video" | "photo" | "text"): Promise<number> {
    if (kind === "photo") return this.config.photoPriceFloor();
    const cfg = await this.config.pricingConfig();
    return cfg.recordedPriceFloor;
  }

  private async validatePaidPrice(
    priceUgx: number | undefined,
    kind: "video" | "photo" | "text",
  ): Promise<number> {
    if (priceUgx == null || !Number.isInteger(priceUgx)) {
      throw badRequest("price_required", "Paid content needs an integer priceUgx");
    }
    const floor = await this.priceFloorFor(kind);
    const check = validateRecordedPrice(priceUgx, { recordedPriceFloor: floor });
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
    if (input.overlays !== undefined) patch.overlays = input.overlays;
    if (input.textStyle !== undefined) patch.textStyle = input.textStyle;
    if (input.musicTrackId !== undefined) patch.musicTrackId = input.musicTrackId;
    if (input.musicStartMs !== undefined) patch.musicStartMs = input.musicStartMs;
    if (input.musicEndMs !== undefined) patch.musicEndMs = input.musicEndMs;
    if (input.musicVolume !== undefined) patch.musicVolume = input.musicVolume;

    // Pricing status change (§4.5.1). Note: already-distributed copies are not
    // recalled (free→paid) and existing buyers keep access (paid→free); the app
    // surfaces those warnings — the API simply applies the new status forward.
    const nextPricing = input.pricing ?? item.pricing;
    if (nextPricing === "paid") {
      patch.pricing = "paid";
      patch.priceUgx = await this.validatePaidPrice(
        input.priceUgx ?? item.priceUgx ?? undefined,
        item.kind,
      );
    } else if (nextPricing === "free") {
      // Flipping a paid video to free consumes the free-minutes allowance.
      if (item.pricing !== "free" && item.durationSeconds != null) {
        await this.assertFreeMinutesAllows(item.creatorId, item.durationSeconds);
      }
      patch.pricing = "free";
      patch.priceUgx = null;
    }

    return this.mutate(id, userId, patch);
  }

  async publish(id: string, userId: string): Promise<Content> {
    const item = await this.requireOwnedContent(id, userId);
    if (item.kind !== "text" && !this.ownsKey(item, item.r2Key, "media")) throw badRequest("media_required", "Upload media before publishing");
    return this.mutate(id, userId, { status: "published", publishedAt: new Date() });
  }

  /** Archive / unpublish — reversible; buyers keep access (§4.5.5). */
  async archive(id: string, userId: string): Promise<Content> {
    await this.requireOwnedContent(id, userId);
    return this.mutate(id, userId, { status: "archived" });
  }

  async unarchive(id: string, userId: string): Promise<Content> {
    return this.publish(id, userId);
  }

  /**
   * Hard-delete (§4.5.5): media is gone and buyers' entitlements are revoked,
   * but the financial ledger is retained (never touched here).
   */
  async hardDelete(id: string, userId: string): Promise<{ deleted: true }> {
    const item = await this.requireOwnedContent(id, userId);
    const now = new Date();
    await this.mutate(id, userId, { status: "deleted", deletedAt: now });
    await this.entitlements.revokeForContent(item.id, now);
    // Purge the media bytes from R2 (§4.5.5 — delete the media, keep the ledger).
    const keys = [this.ownsKey(item, item.r2Key, "media") ? item.r2Key : null,
      this.ownsKey(item, item.thumbnailR2Key, "thumb") ? item.thumbnailR2Key : null].filter((k): k is string => !!k);
    if (keys.length) await this.storage.delete(keys);
    return { deleted: true };
  }

  async listPublishedByCreator(creatorId: string, viewerId: string | null = null) {
    return this.presentItems(await this.content.listPublishedByCreator(creatorId), viewerId);
  }

  async listPublishedByUser(userId: string, viewerId: string | null = null) {
    return this.presentItems(await this.content.listPublishedByUserId(userId), viewerId);
  }

  async presentItems<T extends Content>(items: T[], viewerId: string | null = null) {
    const ownedIds = viewerId ? await this.entitlements.listActiveContentIds(viewerId, items.map(it => it.id)) : new Set<string>();
    const creator = viewerId ? await this.creators.findByUserId(viewerId) : undefined;
    return items.map(it => contentView(it, ownedIds.has(it.id) || creator?.id === it.creatorId));
  }

  /** Record one play/view of a post (published only; deleted posts are ignored). */
  recordView(id: string): Promise<unknown> {
    return this.content.incrementViewCount(id);
  }

  async getForViewer(id: string, viewerId: string | null = null): Promise<Content> {
    const item = await this.content.findById(id);
    if (!item || item.status === "deleted") throw notFound("content");
    if (item.status !== "published") await this.authorizeMedia(item, viewerId);
    return (await this.presentItems([item], viewerId))[0]!;
  }

  /** A single item in full feed shape (creator identity joined) — used to open
   *  a post from search results / deep links. */
  async getCard(id: string, viewerId: string | null = null) {
    const item = await this.content.findFeedItemById(id);
    if (!item || item.status === "deleted") throw notFound("content");
    if (item.status !== "published") await this.authorizeMedia(item, viewerId);
    return (await this.presentItems([item], viewerId))[0]!;
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
    return this.presentItems(items, viewerUserId);
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
    if (item.kind === "text") throw badRequest("text_media", "Text posts do not accept primary media");
    if (item.kind === "photo") {
      const image = await validateImageUpload(body, contentType, 8 * 1048576);
      body = image.body; contentType = image.contentType;
    } else {
      contentType = contentType?.split(";")[0]?.trim().toLowerCase();
      if (contentType !== "video/mp4" && contentType !== "video/quicktime" && contentType !== "video/webm") {
        throw badRequest("unsupported_video", "Upload an MP4, QuickTime or WebM video");
      }
    }
    const { size } = await this.storage.put(key, body, contentType);
    const updated = await this.mutate(id, userId, { r2Key: key, sizeBytes: size });
    // Replace: drop the previous object, if any.
    if (this.ownsKey(item, item.r2Key, "media") && item.r2Key !== key) await this.storage.delete(item.r2Key!);
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
    const image = await validateImageUpload(body, contentType, 2 * 1048576);
    body = image.body; contentType = image.contentType;
    await this.storage.put(key, body, contentType);
    const updated = await this.mutate(id, userId, { thumbnailR2Key: key });
    if (this.ownsKey(item, item.thumbnailR2Key, "thumb") && item.thumbnailR2Key !== key) {
      await this.storage.delete(item.thumbnailR2Key!);
    }
    return updated;
  }

  /**
   * Open the media object for a viewer, enforcing access (§4.4/§4.5):
   *  - quarantine/deletion blocks everyone;
   *  - the owner can preview drafts; existing buyers can open archived items;
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

    if (!item.r2Key || !this.ownsKey(item, item.r2Key, "media")) throw notFound("media");
    const object = await this.storage.get(item.r2Key, range);
    if (!object) throw notFound("media");
    return { object, content: item };
  }

  /** Only published public covers; paid photo covers may contain original bytes. */
  async openThumbnail(id: string): Promise<R2ObjectBody> {
    const item = await this.content.findById(id);
    if (!item || item.status !== "published" || !item.thumbnailR2Key ||
      (item.kind === "photo" && item.pricing === "paid") ||
      !this.ownsKey(item, item.thumbnailR2Key, "thumb")) throw notFound("thumbnail");
    const object = await this.storage.get(item.thumbnailR2Key);
    if (!object) throw notFound("thumbnail");
    return object;
  }

  private async authorizeMedia(item: Content, userId: string | null): Promise<void> {
    if (item.status === "quarantined" || item.status === "deleted") throw forbidden("content is not available");
    if (userId) {
      const creator = await this.creators.findById(item.creatorId);
      if (creator && creator.userId === userId) return; // owner
    }
    if (item.status !== "published" && item.status !== "archived") throw forbidden("content is not available");
    if (item.status === "published" && item.pricing === "free") return;

    // Paid: require an active entitlement.
    if (!userId) throw forbidden("purchase required");
    const ent = await this.entitlements.findActive(userId, "contentId", item.id);
    if (!ent) throw forbidden("purchase required");
  }

  private ownsKey(item: Content, key: string | null, kind: "media" | "thumb"): boolean {
    return !!key && key.startsWith(`content/${item.id}/${kind}/`);
  }

  private async mutate(id: string, userId: string, patch: Partial<Content>): Promise<Content> {
    const updated = await this.content.updateOwned(id, userId, patch);
    if (!updated) throw forbidden("Content or creator is no longer available for editing");
    return updated;
  }
}
