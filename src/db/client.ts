import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * The dialect-agnostic query layer (§2.4 portability rule #1). ALL data access
 * goes through a Drizzle instance created here — no raw D1-binding queries
 * scattered through the codebase.
 *
 * On a future migration to self-hosted Postgres, ONLY this file (and the driver
 * import) changes: swap `drizzle-orm/d1` for `drizzle-orm/node-postgres` and
 * pass a pg pool. The schema and every repository stay put.
 */
export type Database = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}

export { schema };
