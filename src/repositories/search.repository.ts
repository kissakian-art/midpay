import { and, desc, eq, isNull, like, ne, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { comments, content, creators, tracks, users } from "../db/schema";
import type { FeedItem } from "./content.repository";

export interface CreatorHit {
  id: string;
  handle: string;
  displayName: string | null;
  avatarR2Key: string | null;
}
export interface TrackHit {
  id: string;
  title: string;
  artist: string | null;
}
export interface CommentHit {
  id: string;
  body: string;
  contentId: string;
  authorHandle: string;
}

/**
 * SearchRepository — read-only text search across creators, posts, sounds and
 * comments. Uses case-insensitive LIKE (ASCII) on the relevant text columns.
 */
export class SearchRepository {
  constructor(private readonly db: Database) {}

  searchCreators(term: string, limit: number): Promise<CreatorHit[]> {
    return this.db
      .select({
        id: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarR2Key: users.avatarR2Key,
      })
      .from(users)
      .where(and(ne(users.status, "deleted"), or(like(users.handle, term), like(users.displayName, term))))
      .limit(limit)
      .all();
  }

  searchTracks(term: string, limit: number): Promise<TrackHit[]> {
    return this.db
      .select({ id: tracks.id, title: tracks.title, artist: tracks.artist })
      .from(tracks)
      .where(
        and(
          isNull(tracks.deletedAt),
          eq(tracks.isPublic, true),
          or(like(tracks.title, term), like(tracks.artist, term)),
        ),
      )
      .orderBy(desc(tracks.createdAt))
      .limit(limit)
      .all();
  }

  searchComments(term: string, limit: number): Promise<CommentHit[]> {
    return this.db
      .select({
        id: comments.id,
        body: comments.body,
        contentId: comments.contentId,
        authorHandle: users.handle,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .innerJoin(content, eq(content.id, comments.contentId))
      .where(and(isNull(comments.deletedAt), eq(content.status, "published"), like(comments.body, term)))
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .all();
  }

  searchPosts(term: string, limit: number): Promise<FeedItem[]> {
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
        musicTitle: tracks.title,
        musicArtist: tracks.artist,
        musicSource: tracks.source,
        musicDurationSeconds: tracks.durationSeconds,
      })
      .from(content)
      .innerJoin(creators, eq(creators.id, content.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .leftJoin(tracks, eq(tracks.id, content.musicTrackId))
      .where(
        and(
          eq(content.status, "published"),
          or(like(content.title, term), like(content.description, term)),
        ),
      )
      .orderBy(desc(content.publishedAt))
      .limit(limit)
      .all();
  }
}
