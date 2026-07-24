import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, uuidPk, uuidRef } from "./_shared";

/**
 * tracks — reusable audio a post can play OVER its media (composed at playback,
 * never muxed into the media bytes). A post references a track by id; the same
 * track can back many posts (TikTok-style "sound reuse").
 *
 * `source`:
 *  - `device`  — uploaded by a creator from their phone.
 *  - `catalog` — curated royalty-free track (owner/admin uploaded), always public.
 * `isPublic` tracks that show up in the shared picker for everyone to reuse.
 * The audio object lives in R2 (§2.2); only the key is stored here.
 */
export const tracks = sqliteTable(
  "tracks",
  {
    id: uuidPk(),
    // Null for catalog tracks seeded without a specific user.
    ownerUserId: uuidRef("owner_user_id"),
    source: text("source", { enum: ["device", "catalog"] })
      .notNull()
      .default("device"),
    title: text("title").notNull(),
    artist: text("artist"),

    r2Key: text("r2_key"), // audio object; null until bytes are uploaded
    durationSeconds: integer("duration_seconds"),
    sizeBytes: integer("size_bytes"),

    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),

    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("tracks_public_idx").on(t.isPublic),
    index("tracks_owner_idx").on(t.ownerUserId),
  ],
);

export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
