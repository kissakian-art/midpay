import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  commentLikes,
  comments,
  content,
  creators,
  follows,
  likes,
  users,
  type Comment,
} from "../db/schema";

/** Public author/user summary embedded in social listings. */
export interface UserSummary {
  id: string;
  handle: string;
  displayName: string | null;
  avatarR2Key: string | null;
}

const userSummaryCols = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  avatarR2Key: users.avatarR2Key,
};

/**
 * SocialRepository — follows, likes, and comments (§ TikTok-like social graph).
 * These are durable, low-frequency social state and live in D1; high-frequency
 * LIVE chat/reactions ride Durable Objects instead (§2.4).
 */
export class SocialRepository {
  constructor(private readonly db: Database) {}

  // --- Follows ---
  followExists(followerId: string, followingId: string): Promise<{ id: string } | undefined> {
    return this.db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
      .get();
  }

  createFollow(followerId: string, followingId: string): Promise<unknown> {
    return this.db.insert(follows).values({ followerId, followingId }).run();
  }

  deleteFollow(followerId: string, followingId: string): Promise<unknown> {
    return this.db
      .delete(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
      .run();
  }

  listFollowers(userId: string): Promise<UserSummary[]> {
    return this.db
      .select(userSummaryCols)
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(eq(follows.followingId, userId))
      .all();
  }

  listFollowing(userId: string): Promise<UserSummary[]> {
    return this.db
      .select(userSummaryCols)
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followingId))
      .where(eq(follows.followerId, userId))
      .all();
  }

  async followCounts(userId: string): Promise<{ followers: number; following: number }> {
    const followers = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followingId, userId))
      .get();
    const following = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followerId, userId))
      .get();
    return { followers: followers?.n ?? 0, following: following?.n ?? 0 };
  }

  /**
   * Aggregate post stats for a user's profile header (§ TikTok-style: posts +
   * total likes across everything they've published).
   */
  async contentStats(userId: string): Promise<{ posts: number; likes: number }> {
    const row = await this.db
      .select({
        posts: sql<number>`count(*)`,
        likes: sql<number>`coalesce(sum(${content.likeCount}), 0)`,
      })
      .from(content)
      .innerJoin(creators, eq(creators.id, content.creatorId))
      .where(and(eq(creators.userId, userId), eq(content.status, "published")))
      .get();
    return { posts: row?.posts ?? 0, likes: row?.likes ?? 0 };
  }

  // --- Likes ---
  likeExists(userId: string, contentId: string): Promise<{ id: string } | undefined> {
    return this.db
      .select({ id: likes.id })
      .from(likes)
      .where(and(eq(likes.userId, userId), eq(likes.contentId, contentId)))
      .get();
  }

  createLike(userId: string, contentId: string): Promise<unknown> {
    return this.db.insert(likes).values({ userId, contentId }).run();
  }

  deleteLike(userId: string, contentId: string): Promise<unknown> {
    return this.db
      .delete(likes)
      .where(and(eq(likes.userId, userId), eq(likes.contentId, contentId)))
      .run();
  }

  // --- Comments ---
  createComment(row: {
    contentId: string;
    userId: string;
    parentId?: string | null;
    body: string;
  }): Promise<Comment> {
    return this.db.insert(comments).values(row).returning().get();
  }

  findComment(id: string): Promise<Comment | undefined> {
    return this.db.select().from(comments).where(eq(comments.id, id)).get();
  }

  listComments(contentId: string): Promise<(Comment & { author: UserSummary })[]> {
    return this.db
      .select({
        id: comments.id,
        contentId: comments.contentId,
        userId: comments.userId,
        parentId: comments.parentId,
        body: comments.body,
        likeCount: comments.likeCount,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        deletedAt: comments.deletedAt,
        author: userSummaryCols,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.contentId, contentId))
      .orderBy(desc(comments.createdAt))
      .all();
  }

  softDeleteComment(id: string, now: Date): Promise<unknown> {
    return this.db
      .update(comments)
      .set({ deletedAt: now, body: "[deleted]" })
      .where(eq(comments.id, id))
      .run();
  }

  // --- Comment reactions ---
  commentLikeExists(userId: string, commentId: string): Promise<{ id: string } | undefined> {
    return this.db
      .select({ id: commentLikes.id })
      .from(commentLikes)
      .where(and(eq(commentLikes.userId, userId), eq(commentLikes.commentId, commentId)))
      .get();
  }

  createCommentLike(userId: string, commentId: string): Promise<unknown> {
    return this.db.insert(commentLikes).values({ userId, commentId }).run();
  }

  deleteCommentLike(userId: string, commentId: string): Promise<unknown> {
    return this.db
      .delete(commentLikes)
      .where(and(eq(commentLikes.userId, userId), eq(commentLikes.commentId, commentId)))
      .run();
  }

  bumpCommentLikeCount(commentId: string, delta: 1 | -1): Promise<unknown> {
    const next = delta === 1 ? sql`${comments.likeCount} + 1` : sql`max(0, ${comments.likeCount} - 1)`;
    return this.db.update(comments).set({ likeCount: next }).where(eq(comments.id, commentId)).run();
  }

  /** Which of the given comment ids the viewer has liked. */
  async listLikedCommentIds(userId: string, commentIds: string[]): Promise<Set<string>> {
    if (commentIds.length === 0) return new Set();
    const rows = await this.db
      .select({ commentId: commentLikes.commentId })
      .from(commentLikes)
      .where(and(eq(commentLikes.userId, userId), inArray(commentLikes.commentId, commentIds)))
      .all();
    return new Set(rows.map((r) => r.commentId));
  }
}
