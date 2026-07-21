import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { liveEvents, type LiveEvent, type NewLiveEvent } from "../db/schema";

export class LiveRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<LiveEvent | undefined> {
    return this.db.select().from(liveEvents).where(eq(liveEvents.id, id)).get();
  }

  create(row: NewLiveEvent): Promise<LiveEvent> {
    return this.db.insert(liveEvents).values(row).returning().get();
  }

  listByStatus(status: LiveEvent["status"]): Promise<LiveEvent[]> {
    return this.db.select().from(liveEvents).where(eq(liveEvents.status, status)).all();
  }

  listByCreator(creatorId: string): Promise<LiveEvent[]> {
    return this.db
      .select()
      .from(liveEvents)
      .where(eq(liveEvents.creatorId, creatorId))
      .orderBy(desc(liveEvents.createdAt))
      .all();
  }

  setStatus(
    id: string,
    status: LiveEvent["status"],
    patch: Partial<LiveEvent> = {},
  ): Promise<LiveEvent | undefined> {
    return this.db
      .update(liveEvents)
      .set({ status, ...patch })
      .where(eq(liveEvents.id, id))
      .returning()
      .get();
  }

  incrementTicketsSold(id: string): Promise<unknown> {
    return this.db
      .update(liveEvents)
      .set({ ticketsSold: sql`${liveEvents.ticketsSold} + 1` })
      .where(eq(liveEvents.id, id))
      .run();
  }
}
