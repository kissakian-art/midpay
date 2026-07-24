import type { Comment } from "../db/schema";
import { ContentRepository } from "../repositories/content.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { SocialRepository, type UserSummary } from "../repositories/social.repository";
import { UserRepository } from "../repositories/user.repository";
import { badRequest, forbidden, notFound } from "./errors";

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string | null;
  avatarR2Key: string | null;
  bio: string | null;
  followers: number;
  following: number;
  /** Total likes across all their published posts. */
  likes: number;
  posts: number;
  /** Whether the signed-in viewer follows this user (false when anonymous). */
  isFollowing: boolean;
  /** True when the viewer is looking at their own profile. */
  isSelf: boolean;
}

/**
 * SocialService — follows, likes, and comments (the TikTok-like social graph).
 * Denormalized counters on `content` are kept in step with the like/comment
 * tables here.
 */
export class SocialService {
  constructor(
    private readonly social: SocialRepository,
    private readonly users: UserRepository,
    private readonly content: ContentRepository,
    private readonly creators: CreatorRepository,
  ) {}

  // --- Follows ---
  async follow(followerId: string, targetUserId: string): Promise<{ following: true }> {
    if (followerId === targetUserId) throw badRequest("self_follow", "You cannot follow yourself");
    if (!(await this.users.findById(targetUserId))) throw notFound("user");
    if (!(await this.social.followExists(followerId, targetUserId))) {
      await this.social.createFollow(followerId, targetUserId);
    }
    return { following: true };
  }

  async unfollow(followerId: string, targetUserId: string): Promise<{ following: false }> {
    await this.social.deleteFollow(followerId, targetUserId);
    return { following: false };
  }

  listFollowers(userId: string): Promise<UserSummary[]> {
    return this.social.listFollowers(userId);
  }

  listFollowing(userId: string): Promise<UserSummary[]> {
    return this.social.listFollowing(userId);
  }

  async profile(userId: string, viewerId?: string | null): Promise<PublicProfile> {
    const user = await this.users.findById(userId);
    if (!user || user.status === "deleted") throw notFound("user");
    const [counts, stats, following] = await Promise.all([
      this.social.followCounts(userId),
      this.social.contentStats(userId),
      viewerId && viewerId !== userId
        ? this.social.followExists(viewerId, userId)
        : Promise.resolve(undefined),
    ]);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      avatarR2Key: user.avatarR2Key,
      bio: user.bio,
      followers: counts.followers,
      following: counts.following,
      likes: stats.likes,
      posts: stats.posts,
      isFollowing: !!following,
      isSelf: viewerId === userId,
    };
  }

  /** A user's published posts, for the profile grid. */
  listUserContent(userId: string) {
    return this.content.listPublishedByUserId(userId);
  }

  // --- Likes ---
  private async liveContentOr404(contentId: string) {
    const item = await this.content.findById(contentId);
    if (!item || item.status === "deleted") throw notFound("content");
    return item;
  }

  async like(userId: string, contentId: string): Promise<{ liked: true }> {
    await this.liveContentOr404(contentId);
    if (!(await this.social.likeExists(userId, contentId))) {
      await this.social.createLike(userId, contentId);
      await this.content.bumpCounter(contentId, "likeCount", 1);
    }
    return { liked: true };
  }

  async unlike(userId: string, contentId: string): Promise<{ liked: false }> {
    if (await this.social.likeExists(userId, contentId)) {
      await this.social.deleteLike(userId, contentId);
      await this.content.bumpCounter(contentId, "likeCount", -1);
    }
    return { liked: false };
  }

  // --- Comments ---
  async addComment(
    userId: string,
    contentId: string,
    body: string,
    parentId?: string,
  ): Promise<Comment> {
    if (body.trim() === "") throw badRequest("empty_comment", "Comment body is required");
    await this.liveContentOr404(contentId);
    if (parentId) {
      const parent = await this.social.findComment(parentId);
      if (!parent || parent.contentId !== contentId) throw badRequest("bad_parent", "Invalid parent comment");
    }
    const comment = await this.social.createComment({ contentId, userId, parentId, body });
    await this.content.bumpCounter(contentId, "commentCount", 1);
    return comment;
  }

  async listComments(contentId: string, viewerId?: string | null) {
    const rows = await this.social.listComments(contentId);
    if (!viewerId) return rows.map((c) => ({ ...c, likedByMe: false }));
    const liked = await this.social.listLikedCommentIds(
      viewerId,
      rows.map((c) => c.id),
    );
    return rows.map((c) => ({ ...c, likedByMe: liked.has(c.id) }));
  }

  async likeComment(userId: string, contentId: string, commentId: string): Promise<{ liked: true }> {
    const comment = await this.social.findComment(commentId);
    if (!comment || comment.contentId !== contentId || comment.deletedAt) throw notFound("comment");
    if (!(await this.social.commentLikeExists(userId, commentId))) {
      await this.social.createCommentLike(userId, commentId);
      await this.social.bumpCommentLikeCount(commentId, 1);
    }
    return { liked: true };
  }

  async unlikeComment(userId: string, _contentId: string, commentId: string): Promise<{ liked: false }> {
    if (await this.social.commentLikeExists(userId, commentId)) {
      await this.social.deleteCommentLike(userId, commentId);
      await this.social.bumpCommentLikeCount(commentId, -1);
    }
    return { liked: false };
  }

  async deleteComment(userId: string, contentId: string, commentId: string): Promise<{ deleted: true }> {
    const comment = await this.social.findComment(commentId);
    if (!comment || comment.contentId !== contentId || comment.deletedAt) throw notFound("comment");

    // Author OR the content's creator may delete (§ moderation of own content).
    let allowed = comment.userId === userId;
    if (!allowed) {
      const item = await this.content.findById(contentId);
      const creator = item ? await this.creators.findById(item.creatorId) : undefined;
      allowed = !!creator && creator.userId === userId;
    }
    if (!allowed) throw forbidden("not your comment");

    await this.social.softDeleteComment(commentId, new Date());
    await this.content.bumpCounter(contentId, "commentCount", -1);
    return { deleted: true };
  }
}
