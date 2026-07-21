import { integer, text } from "drizzle-orm/sqlite-core";

/**
 * Shared column builders — keep every table portable and consistent (§2.4).
 *
 * Portability rules honored here:
 *  - UUID text primary keys, NOT SQLite AUTOINCREMENT.
 *  - Timestamps stored as integer unix seconds (portable to a Postgres
 *    `timestamptz` via epoch), exposed as JS `Date` through Drizzle.
 *  - Money stored as INTEGER whole UGX. UGX has no circulating minor unit,
 *    so integer UGX is exact and avoids floating-point drift in the ledger.
 */

/** UUID primary key, generated app-side (portable across SQLite/Postgres). */
export const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** A UUID foreign-key / reference column (no FK constraint attached here). */
export const uuidRef = (name: string) => text(name);

/** Whole-UGX money amount. */
export const ugx = (name: string) => integer(name);

/** created_at / updated_at, unix seconds. */
export const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Optional soft-delete marker. */
export const deletedAt = () => integer("deleted_at", { mode: "timestamp" });
