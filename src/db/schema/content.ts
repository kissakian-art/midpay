import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, ugx, updatedAt, uuidPk, uuidRef } from "./_shared";

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

    kind: text("kind", { enum: ["video", "photo"] })
      .notNull()
      .default("video"),
    title: text("title"),
    description: text("description"),

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
