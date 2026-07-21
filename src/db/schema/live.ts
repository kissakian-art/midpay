import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { createdAt, ugx, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * live_events — a scheduled/active/ended live broadcast (§4.2, §3.3, §7.6).
 *
 * The §3.3 Live Duration-Based Price Floor is enforced at scheduling time in
 * the service layer:
 *   minLivePrice = LIVE_MIN_PRICE_PER_HOUR × ceil(declaredDurationMin / 60)
 * `ticketPriceUgx` must be ≥ that floor. The value of the floor that was
 * applied is snapshotted in `priceFloorAppliedUgx` for audit, since the config
 * constant can change over time (§7.2 versioned config).
 *
 * Runtime cap: the stream auto-terminates at declaredDurationMin + grace (§3.3).
 * A completed broadcast is recorded to R2 and linked here as a replay (§4.2).
 */
export const liveEvents = sqliteTable(
  "live_events",
  {
    id: uuidPk(),
    creatorId: uuidRef("creator_id").notNull(),

    title: text("title"),
    description: text("description"),

    // §3.3 declared maximum duration (minutes) — the value the price was
    // validated against and the stream auto-terminates at (+ grace).
    declaredDurationMin: integer("declared_duration_min").notNull(),

    // Creator-set ticket price (whole UGX), validated ≥ the price floor.
    ticketPriceUgx: ugx("ticket_price_ugx").notNull(),
    // Snapshot of the enforced floor at scheduling time (audit trail).
    priceFloorAppliedUgx: ugx("price_floor_applied_ugx").notNull(),

    // 'scheduled' | 'live' | 'ended' | 'terminated' | 'cancelled'
    // 'terminated' = auto-ended by the runtime cap (§3.3.3).
    status: text("status", {
      enum: ["scheduled", "live", "ended", "terminated", "cancelled"],
    })
      .notNull()
      .default("scheduled"),

    scheduledStartAt: integer("scheduled_start_at", { mode: "timestamp" }),
    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),

    // Live economics tracking (§7.6 per-event economics). Small aggregates only;
    // the raw per-minute viewer firehose belongs in Analytics Engine, not D1.
    peakConcurrentViewers: integer("peak_concurrent_viewers").notNull().default(0),
    ticketsSold: integer("tickets_sold").notNull().default(0),
    streamingMinutesConsumed: integer("streaming_minutes_consumed")
      .notNull()
      .default(0),

    // Replay archive (§4.2) — R2 object of the recorded broadcast.
    replayR2Key: text("replay_r2_key"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("live_events_creator_idx").on(t.creatorId),
    index("live_events_status_idx").on(t.status),
  ],
);

export type LiveEvent = typeof liveEvents.$inferSelect;
export type NewLiveEvent = typeof liveEvents.$inferInsert;
