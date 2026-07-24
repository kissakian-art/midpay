import { index, sqliteTable } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, uuidPk, uuidRef } from "./_shared";
import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * backgrounds — admin/owner-uploaded image backgrounds for TEXT posts, available
 * to every creator in the composer (like the music catalog). The image lives in
 * R2; only the key is stored here.
 */
export const backgrounds = sqliteTable(
  "backgrounds",
  {
    id: uuidPk(),
    ownerUserId: uuidRef("owner_user_id"),
    r2Key: text("r2_key"), // image object; null until uploaded
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("backgrounds_public_idx").on(t.isPublic)],
);

export type Background = typeof backgrounds.$inferSelect;
export type NewBackground = typeof backgrounds.$inferInsert;
