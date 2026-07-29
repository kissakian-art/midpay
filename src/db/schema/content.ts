import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, ugx, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * A creator-authored text overlay rendered OVER the media in MidPay's own player
 * (composed at playback — never baked into the media bytes, so no re-encode).
 * Coordinates are normalized to the displayed media rectangle (0..1) so they map
 * across devices/screen sizes; `x`,`y` are the overlay box's TOP-LEFT.
 */
export interface TextOverlay {
  text: string;
  x: number; // 0..1, top-left X as a fraction of media width
  y: number; // 0..1, top-left Y as a fraction of media height
  size: number; // font size as a fraction of media width (e.g. 0.06)
  color: string; // hex text colour
  bg: string | null; // shape background colour (hex, may carry alpha) or null = none
}

/**
 * Visual style for a TEXT post — a coloured/gradient background with a styled
 * caption (Instagram/Facebook-style). Self-contained (concrete values, not
 * preset ids) so old posts keep looking right even if the app's presets change.
 */
export interface TextStyle {
  bg: string[]; // 1 colour = solid, 2+ = gradient stops (hex)
  bgImage?: string | null; // an admin-catalog background id (image), overrides bg
  color: string; // text colour (hex)
  font: string | null; // fontFamily (e.g. Android 'serif'), null = default
  align: "left" | "center" | "right";
  bold?: boolean;
}

/**
 * content — metadata for a recorded video or photo (§4.5). The media bytes live
 * in R2 (§2.2), NEVER in D1; only the R2 object key is stored here.
 *
 * Pricing status is creator-controlled and editable (§4.5.1): every item is
 * `free` or `paid`. Protection profile follows status automatically (§4.4) and
 * is enforced client-side; the status here is the source of truth.
 */
export const content = sqliteTable(
  "content",
  {
    id: uuidPk(),
    creatorId: uuidRef("creator_id").notNull(),

    // "text" posts carry no media — the body lives in `description` and no
    // r2Key is set (§ status-style posts alongside video/photo).
    kind: text("kind", { enum: ["video", "photo", "text"] })
      .notNull()
      .default("video"),
    title: text("title"),
    description: text("description"),

    // Creator text overlays (§ compose-at-playback). JSON array; NULL when none.
    overlays: text("overlays", { mode: "json" }).$type<TextOverlay[]>(),

    // Visual style for a text post (background + font/colour). NULL = plain.
    textStyle: text("text_style", { mode: "json" }).$type<TextStyle>(),

    // Optional background music (§ compose-at-playback): a reference to a track
    // (see music.ts) played over the media, from `musicStartMs` into the track.
    musicTrackId: uuidRef("music_track_id"),
    // Music segment [musicStartMs, musicEndMs) into the track. For video posts
    // musicEndMs is usually NULL (music is capped to the video length at
    // playback); for photo/text posts the segment length IS the post duration.
    musicStartMs: integer("music_start_ms"),
    musicEndMs: integer("music_end_ms"),
    // Music playback loudness, 0..100 (§ compose-at-playback). NULL = full (100).
    // Lets a tutorial duck background music under the clip's own narration.
    musicVolume: integer("music_volume"),

    // Media pointers — R2 only (§2.2).
    r2Key: text("r2_key"), // encoded media object
    thumbnailR2Key: text("thumbnail_r2_key"),
    durationSeconds: integer("duration_seconds"), // for videos; ≤ CLIP_MAX (§4.3)
    sizeBytes: integer("size_bytes"),

    // Pricing status (§4.5.1). Price is whole UGX, ≥ recorded floor (§3.2)
    // when pricing === 'paid'. NULL price for free content.
    pricing: text("pricing", { enum: ["free", "paid"] })
      .notNull()
      .default("free"),
    priceUgx: ugx("price_ugx"),

    // Lifecycle (§4.5.4/§4.5.5): published (live on profile & for sale),
    // archived (creator unpublished — hidden, buyers keep access, reversible),
    // quarantined (ADMIN takedown — hidden by moderation, reversible by admin
    // only, §7.4), deleted (hard-delete — media gone, buyers lose access; the
    // ledger is retained regardless, see ledger.ts).
    status: text("status", {
      enum: ["draft", "published", "archived", "quarantined", "deleted"],
    })
      .notNull()
      .default("draft"),

    // Denormalized social counters (source of truth is likes/comments tables).
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    purchaseCount: integer("purchase_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),

    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("content_creator_idx").on(t.creatorId),
    index("content_status_idx").on(t.status),
  ],
);

/** tags — normalized hashtag vocabulary (search / discovery). */
export const tags = sqliteTable(
  "tags",
  {
    id: uuidPk(),
    label: text("label").notNull(), // normalized, lowercased
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_label_uq").on(t.label)],
);

/** content_tags — many-to-many join between content and tags. */
export const contentTags = sqliteTable(
  "content_tags",
  {
    contentId: uuidRef("content_id").notNull(),
    tagId: uuidRef("tag_id").notNull(),
  },
  (t) => [
    uniqueIndex("content_tags_pk").on(t.contentId, t.tagId),
    index("content_tags_tag_idx").on(t.tagId),
  ],
);

export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
export type Tag = typeof tags.$inferSelect;
