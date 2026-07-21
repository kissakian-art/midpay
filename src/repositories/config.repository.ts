import { and, desc, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { platformConfig, type PlatformConfig } from "../db/schema";

/**
 * ConfigRepository — writes and history for the versioned, effective-dated
 * platform_config table (§7.2). Writes are append-only (a new row per change);
 * nothing is ever updated in place, so the rule set at any past time is
 * reconstructable.
 */
export class ConfigRepository {
  constructor(private readonly db: Database) {}

  /** The row currently in effect for a key (latest effectiveFrom ≤ now). */
  currentlyEffective(key: string, now: Date): Promise<PlatformConfig | undefined> {
    return this.db
      .select()
      .from(platformConfig)
      .where(and(eq(platformConfig.key, key), lte(platformConfig.effectiveFrom, now)))
      .orderBy(desc(platformConfig.effectiveFrom))
      .get();
  }

  history(key: string): Promise<PlatformConfig[]> {
    return this.db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, key))
      .orderBy(desc(platformConfig.effectiveFrom))
      .all();
  }

  append(row: {
    key: string;
    valueJson: string;
    effectiveFrom: Date;
    createdByAdminId: string;
  }): Promise<PlatformConfig> {
    return this.db.insert(platformConfig).values(row).returning().get();
  }
}
