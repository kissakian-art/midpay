import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * users — base account for every person on the platform (§ app is TikTok-like:
 * follows, messages, inbox, profile, comments, likes). A user becomes a
 * creator by gaining a row in `creators` (creators.ts); a user with no creator
 * row is a pure viewer/buyer.
 */
export const users = sqliteTable(
  "users",
  {
    id: uuidPk(),
    // Uganda mobile-money-centric: phone is the primary identity for payments.
    phone: text("phone").notNull(),
    email: text("email"),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    avatarR2Key: text("avatar_r2_key"),
    bio: text("bio"),
    // 'active' | 'suspended' | 'banned' | 'deleted'
    status: text("status", {
      enum: ["active", "suspended", "banned", "deleted"],
    })
      .notNull()
      .default("active"),
    phoneVerifiedAt: integer("phone_verified_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("users_phone_uq").on(t.phone),
    uniqueIndex("users_handle_uq").on(t.handle),
  ],
);

/**
 * follows — directional social graph edge (follower -> following).
 */
export const follows = sqliteTable(
  "follows",
  {
    id: uuidPk(),
    followerId: uuidRef("follower_id").notNull(),
    followingId: uuidRef("following_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("follows_pair_uq").on(t.followerId, t.followingId),
    index("follows_following_idx").on(t.followingId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Follow = typeof follows.$inferSelect;
