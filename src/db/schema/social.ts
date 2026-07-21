import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * Social graph interactions (TikTok-like): likes, comments, and direct
 * messages / inbox. These are core relational state and stay in D1. Note:
 * high-frequency LIVE chat/reactions do NOT live here — they ride Durable
 * Objects (§2.4). This is for durable, low-frequency social state.
 */

/** likes — a user likes a content item. */
export const likes = sqliteTable(
  "likes",
  {
    id: uuidPk(),
    userId: uuidRef("user_id").notNull(),
    contentId: uuidRef("content_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("likes_pair_uq").on(t.userId, t.contentId),
    index("likes_content_idx").on(t.contentId),
  ],
);

/** comments — threaded comments on content (parentId for one level of replies). */
export const comments = sqliteTable(
  "comments",
  {
    id: uuidPk(),
    contentId: uuidRef("content_id").notNull(),
    userId: uuidRef("user_id").notNull(),
    parentId: uuidRef("parent_id"), // NULL = top-level
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("comments_content_idx").on(t.contentId)],
);

/**
 * conversations — a 1:1 DM thread between two users. `userAId`/`userBId` are
 * stored in a canonical (sorted) order so a pair maps to exactly one row.
 */
export const conversations = sqliteTable(
  "conversations",
  {
    id: uuidPk(),
    userAId: uuidRef("user_a_id").notNull(),
    userBId: uuidRef("user_b_id").notNull(),
    lastMessageAt: createdAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversations_pair_uq").on(t.userAId, t.userBId)],
);

/** messages — a single DM within a conversation (inbox). */
export const messages = sqliteTable(
  "messages",
  {
    id: uuidPk(),
    conversationId: uuidRef("conversation_id").notNull(),
    senderId: uuidRef("sender_id").notNull(),
    body: text("body").notNull(),
    readAt: integer("read_at", { mode: "timestamp" }), // NULL = unread
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export type Like = typeof likes.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
