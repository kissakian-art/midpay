import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { moderationReports, type ModerationReport } from "../db/schema";

type NewReport = typeof moderationReports.$inferInsert;

export class ModerationRepository {
  constructor(private readonly db: Database) {}

  create(row: NewReport): Promise<ModerationReport> {
    return this.db.insert(moderationReports).values(row).returning().get();
  }

  findById(id: string): Promise<ModerationReport | undefined> {
    return this.db
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.id, id))
      .get();
  }

  list(status?: ModerationReport["status"]): Promise<ModerationReport[]> {
    const q = this.db.select().from(moderationReports).$dynamic();
    if (status) q.where(eq(moderationReports.status, status));
    return q.orderBy(desc(moderationReports.createdAt)).all();
  }

  update(id: string, patch: Partial<ModerationReport>): Promise<ModerationReport> {
    return this.db
      .update(moderationReports)
      .set(patch)
      .where(eq(moderationReports.id, id))
      .returning()
      .get();
  }
}
