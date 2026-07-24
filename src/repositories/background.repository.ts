import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { backgrounds, type Background, type NewBackground } from "../db/schema";

export class BackgroundRepository {
  constructor(private readonly db: Database) {}

  create(row: NewBackground): Promise<Background> {
    return this.db.insert(backgrounds).values(row).returning().get();
  }

  update(id: string, patch: Partial<Background>): Promise<Background> {
    return this.db.update(backgrounds).set(patch).where(eq(backgrounds.id, id)).returning().get();
  }

  findById(id: string): Promise<Background | undefined> {
    return this.db.select().from(backgrounds).where(eq(backgrounds.id, id)).get();
  }

  /** Public, non-deleted backgrounds that have an image, newest first. */
  listPublic(): Promise<Background[]> {
    return this.db
      .select()
      .from(backgrounds)
      .where(and(isNull(backgrounds.deletedAt), eq(backgrounds.isPublic, true), sql`${backgrounds.r2Key} is not null`))
      .orderBy(desc(backgrounds.createdAt))
      .all();
  }

  softDelete(id: string, now: Date): Promise<unknown> {
    return this.db.update(backgrounds).set({ deletedAt: now }).where(eq(backgrounds.id, id)).run();
  }
}
