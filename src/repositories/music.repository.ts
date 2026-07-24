import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { tracks, type NewTrack, type Track } from "../db/schema";

/**
 * MusicRepository — data access for audio tracks (§2.4 rule #4). Isolated like
 * every other repository; the rest of the app talks to it, never Drizzle.
 */
export class MusicRepository {
  constructor(private readonly db: Database) {}

  create(row: NewTrack): Promise<Track> {
    return this.db.insert(tracks).values(row).returning().get();
  }

  update(id: string, patch: Partial<Track>): Promise<Track> {
    return this.db.update(tracks).set(patch).where(eq(tracks.id, id)).returning().get();
  }

  findById(id: string): Promise<Track | undefined> {
    return this.db.select().from(tracks).where(eq(tracks.id, id)).get();
  }

  /**
   * The picker library: public, non-deleted tracks that HAVE audio, plus the
   * viewer's own tracks. Optional title/artist search. Newest first.
   */
  listAvailable(viewerUserId: string | null, q: string | undefined, limit: number): Promise<Track[]> {
    const visible = viewerUserId
      ? or(eq(tracks.isPublic, true), eq(tracks.ownerUserId, viewerUserId))
      : eq(tracks.isPublic, true);
    const conds = [isNull(tracks.deletedAt), sql`${tracks.r2Key} is not null`, visible];
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      conds.push(or(like(tracks.title, term), like(tracks.artist, term))!);
    }
    return this.db
      .select()
      .from(tracks)
      .where(and(...conds))
      .orderBy(desc(tracks.createdAt))
      .limit(limit)
      .all();
  }
}
