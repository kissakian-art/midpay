import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { creators, liveEvents, users, type LiveEvent, type NewLiveEvent } from "../db/schema";

/** A live event decorated with its creator's public identity (feed/discovery). */
export interface LiveEventWithCreator extends LiveEvent {
  creatorUserId: string;
  creatorHandle: string;
  creatorDisplayName: string | null;
  creatorAvatarR2Key: string | null;
}

export class LiveRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<LiveEvent | undefined> {
    return this.db.select().from(liveEvents).where(eq(liveEvents.id, id)).get();
  }

  /** Selection of live_events columns plus the creator's public identity. */
  private get withCreatorColumns() {
    return {
      // All live_events columns (getTableColumns keeps this in sync w/ schema).
      ...getTableColumns(liveEvents),
      creatorUserId: users.id,
      creatorHandle: users.handle,
      creatorDisplayName: users.displayName,
      creatorAvatarR2Key: users.avatarR2Key,
    };
  }

  findByIdWithCreator(id: string): Promise<LiveEventWithCreator | undefined> {
    return this.db
      .select(this.withCreatorColumns)
      .from(liveEvents)
      .innerJoin(creators, eq(creators.id, liveEvents.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .where(eq(liveEvents.id, id))
      .get() as Promise<LiveEventWithCreator | undefined>;
  }

  /** Everyone currently broadcasting — newest first (discovery surface). */
  listLiveWithCreator(): Promise<LiveEventWithCreator[]> {
    return this.db
      .select(this.withCreatorColumns)
      .from(liveEvents)
      .innerJoin(creators, eq(creators.id, liveEvents.creatorId))
      .innerJoin(users, eq(users.id, creators.userId))
      .where(eq(liveEvents.status, "live"))
      .orderBy(desc(liveEvents.startedAt))
      .all() as Promise<LiveEventWithCreator[]>;
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
