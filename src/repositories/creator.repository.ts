import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { creators, type Creator, type NewCreator } from "../db/schema";

export class CreatorRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<Creator | undefined> {
    return this.db.select().from(creators).where(eq(creators.id, id)).get();
  }

  findByUserId(userId: string): Promise<Creator | undefined> {
    return this.db.select().from(creators).where(eq(creators.userId, userId)).get();
  }

  create(row: NewCreator): Promise<Creator> {
    return this.db.insert(creators).values(row).returning().get();
  }

  updateByUserId(userId: string, patch: Partial<Creator>): Promise<Creator | undefined> {
    return this.db
      .update(creators)
      .set(patch)
      .where(eq(creators.userId, userId))
      .returning()
      .get();
  }

  updateById(id: string, patch: Partial<Creator>): Promise<Creator | undefined> {
    return this.db
      .update(creators)
      .set(patch)
      .where(eq(creators.id, id))
      .returning()
      .get();
  }
}
