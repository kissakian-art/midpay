import { lt, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { authRateLimits } from "../db/schema";

export class AuthRateLimitRepository {
  constructor(private readonly db: Database) {}

  async attempt(key: string, maximum: number, windowSeconds = 600): Promise<boolean> {
    const windowStart = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds;
    const row = await this.db.insert(authRateLimits).values({ key, windowStart, attempts: 1 })
      .onConflictDoUpdate({ target: authRateLimits.key, set: {
        attempts: sql`case when ${authRateLimits.windowStart} = ${windowStart} then ${authRateLimits.attempts} + 1 else 1 end`,
        windowStart,
      } }).returning().get();
    return row.attempts <= maximum;
  }

  cleanup(): Promise<unknown> {
    return this.db.delete(authRateLimits).where(lt(authRateLimits.windowStart, Math.floor(Date.now() / 1000) - 86400)).run();
  }
}
