import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { content, creators, tracks, users, type Content, type NewContent } from "../db/schema";

/** Feed item: content plus its creator's public identity, plus the attached
 *  sound's public details (null when the post has no music) so the feed can
 *  label a "use this sound" shortcut and hand the track to the studio. */
export interface FeedItem extends Content {
  creatorHandle: string;
  creatorDisplayName: string | null;
  creatorUserId: string;
  creatorAvatarR2Key: string | null;
  musicTitle: string | null;
  musicArtist: string | null;
  musicSource: "device" | "catalog" | null;
  musicDurationSeconds: number | null;
}

/** The joined sound columns shared by every feed-shaped query. */
const musicSelect = {
  musicTitle: tracks.title,
  musicArtist: tracks.artist,
  musicSource: tracks.source,
  musicDurationSeconds: tracks.durationSeconds,
} as const;

/**
 * ContentRepository — example of the isolated data-access layer (§2.4 rule #4).
 * Every table gets a repository like this; the rest of the app talks to
 * repositories, never to Drizzle/D1 directly. On a Postgres migration, these
 * method bodies are unchanged because they use portable Drizzle query builders.
 */
export class ContentRepository {
  constructor(private readonly db: Database) {}

  create(row: NewContent): Promise<Content> {
    return this.db.insert(content).values(row).returning().get();
  }

  findById(id: string): Promise<Content | undefined> {
    return this.db.select().from(content).where(eq(content.id, id)).get();
  }

  /** Published items for a creator's public profile catalog (§4.2). */
  listPublishedByCreator(creatorId: string): Promise<Content[]> {
    return this.db
      .select()
      .from(content)
      .where(
        and(eq(content.creatorId, creatorId), eq(content.status, "published")),
      )
      .orderBy(desc(content.publishedAt))
      .all();
  }

  /** A user's published posts (profile grid), newest first. Full feed shape so
   *  the same card/viewer components work (creator identity included). */
  listPublishedByUserId(userId: string): Promise<FeedItem[]> {
    return this.db
      .select({
        id: content.id,
        creatorId: content.creatorId,
        kind: content.kind,
        title: content.title,
        description: content.description,
        overlays: content.overlays,
        textStyle: content.textStyle,
        musicTrackId: content.musicTrackId,
        musicStartMs: content.musicStartMs,
        musicEndMs: content.musicEndMs,
        musicVolume: content.musicVolume,
        r2Key: content.r2Key,
        thumbnailR2Key: content.thumbnailR2Key,
        durationSeconds: content.durationSeconds,
        sizeBytes: content.sizeBytes,
        pricing: content.pricing,
        priceUgx: content.priceUgx,
        status: content.status,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        purchaseCount: content.purchaseCount,
        publishedAt: content.publishedAt,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        deletedAt: content.deletedAt,
        creatorHandle: users.handle,
        creatorDisplayName: users.displayName,
        creatorUserId: users.id,
        creatorAvatarR2Key: users.avatarR2Key,
        ...musicSelect,
      })
      .from(content)
      .innerJoin(creators, eq(creators.id, content.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .leftJoin(tracks, eq(tracks.id, content.musicTrackId))
      .where(and(eq(creators.userId, userId), eq(content.status, "published")))
      .orderBy(desc(content.publishedAt))
      .all();
  }

  update(id: string, patch: Partial<Content>): Promise<Content> {
    return this.db.update(content).set(patch).where(eq(content.id, id)).returning().get();
  }

  /**
   * Total seconds of a creator's FREE, non-deleted content (§4.5.3 allowance).
   * Photos/text have NULL duration and contribute 0, so this is effectively the
   * creator's free-video minutes used.
   */
  async sumFreeVideoSeconds(creatorId: string): Promise<number> {
    const row = await this.db
      .select({ total: sql<number>`coalesce(sum(${content.durationSeconds}), 0)` })
      .from(content)
      .where(
        and(
          eq(content.creatorId, creatorId),
          eq(content.pricing, "free"),
          ne(content.status, "deleted"),
        ),
      )
      .get();
    return row?.total ?? 0;
  }

  setStatus(
    id: string,
    status: Content["status"],
    patch: Partial<Content> = {},
  ): Promise<Content> {
    return this.db
      .update(content)
      .set({ status, ...patch })
      .where(eq(content.id, id))
      .returning()
      .get();
  }

  incrementPurchaseCount(id: string): Promise<unknown> {
    return this.db
      .update(content)
      .set({ purchaseCount: sql`${content.purchaseCount} + 1` })
      .where(eq(content.id, id))
      .run();
  }

  /**
   * Global feed: recent published content, newest first, with creator identity.
   * Cursor = publishedAt unix seconds of the last item from the previous page.
   */
  listFeed(limit: number, beforePublishedAt?: Date): Promise<FeedItem[]> {
    const conds = [eq(content.status, "published")];
    if (beforePublishedAt) conds.push(lt(content.publishedAt, beforePublishedAt));
    return this.db
      .select({
        id: content.id,
        creatorId: content.creatorId,
        kind: content.kind,
        title: content.title,
        description: content.description,
        overlays: content.overlays,
        textStyle: content.textStyle,
        musicTrackId: content.musicTrackId,
        musicStartMs: content.musicStartMs,
        musicEndMs: content.musicEndMs,
        musicVolume: content.musicVolume,
        r2Key: content.r2Key,
        thumbnailR2Key: content.thumbnailR2Key,
        durationSeconds: content.durationSeconds,
        sizeBytes: content.sizeBytes,
        pricing: content.pricing,
        priceUgx: content.priceUgx,
        status: content.status,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        purchaseCount: content.purchaseCount,
        publishedAt: content.publishedAt,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        deletedAt: content.deletedAt,
        creatorHandle: users.handle,
        creatorDisplayName: users.displayName,
        creatorUserId: users.id,
        creatorAvatarR2Key: users.avatarR2Key,
        ...musicSelect,
      })
      .from(content)
      .innerJoin(creators, eq(creators.id, content.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .leftJoin(tracks, eq(tracks.id, content.musicTrackId))
      .where(and(...conds))
      .orderBy(desc(content.publishedAt))
      .limit(limit)
      .all();
  }

  /** A single content item in full feed shape (creator identity joined). */
  findFeedItemById(id: string): Promise<FeedItem | undefined> {
    return this.db
      .select({
        id: content.id,
        creatorId: content.creatorId,
        kind: content.kind,
        title: content.title,
        description: content.description,
        overlays: content.overlays,
        textStyle: content.textStyle,
        musicTrackId: content.musicTrackId,
        musicStartMs: content.musicStartMs,
        musicEndMs: content.musicEndMs,
        musicVolume: content.musicVolume,
        r2Key: content.r2Key,
        thumbnailR2Key: content.thumbnailR2Key,
        durationSeconds: content.durationSeconds,
        sizeBytes: content.sizeBytes,
        pricing: content.pricing,
        priceUgx: content.priceUgx,
        status: content.status,
        likeCount: content.likeCount,
        commentCount: content.commentCount,
        purchaseCount: content.purchaseCount,
        publishedAt: content.publishedAt,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        deletedAt: content.deletedAt,
        creatorHandle: users.handle,
        creatorDisplayName: users.displayName,
        creatorUserId: users.id,
        creatorAvatarR2Key: users.avatarR2Key,
        ...musicSelect,
      })
      .from(content)
      .innerJoin(creators, eq(creators.id, content.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .leftJoin(tracks, eq(tracks.id, content.musicTrackId))
      .where(eq(content.id, id))
      .get();
  }

  /** Adjust a denormalized social counter by ±1, clamped at 0. */
  bumpCounter(id: string, field: "likeCount" | "commentCount", delta: 1 | -1): Promise<unknown> {
    const col = field === "likeCount" ? content.likeCount : content.commentCount;
    const next = delta === 1 ? sql`${col} + 1` : sql`max(0, ${col} - 1)`;
    return this.db
      .update(content)
      .set({ [field]: next })
      .where(eq(content.id, id))
      .run();
  }
}
