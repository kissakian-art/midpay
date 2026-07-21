import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { entitlements, type Entitlement } from "../db/schema";

export class EntitlementRepository {
  constructor(private readonly db: Database) {}

  create(row: {
    userId: string;
    transactionId: string;
    contentId?: string | null;
    liveEventId?: string | null;
  }): Promise<Entitlement> {
    return this.db.insert(entitlements).values(row).returning().get();
  }

  /** Active access check for a content item or live event. */
  findActive(
    userId: string,
    field: "contentId" | "liveEventId",
    targetId: string,
  ): Promise<Entitlement | undefined> {
    const col =
      field === "contentId" ? entitlements.contentId : entitlements.liveEventId;
    return this.db
      .select()
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, userId),
          eq(col, targetId),
          eq(entitlements.status, "active"),
        ),
      )
      .get();
  }

  /** Which of these content ids does the user actively own? (feed decoration) */
  async listActiveContentIds(userId: string, contentIds: string[]): Promise<Set<string>> {
    if (contentIds.length === 0) return new Set();
    const rows = await this.db
      .select({ contentId: entitlements.contentId })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.userId, userId),
          eq(entitlements.status, "active"),
          inArray(entitlements.contentId, contentIds),
        ),
      )
      .all();
    return new Set(rows.map((r) => r.contentId).filter((id): id is string => !!id));
  }

  /** Revoke all entitlements for a hard-deleted content item (§4.5.5). */
  revokeForContent(contentId: string, now: Date): Promise<unknown> {
    return this.db
      .update(entitlements)
      .set({ status: "revoked", revokedAt: now })
      .where(eq(entitlements.contentId, contentId))
      .run();
  }
}
