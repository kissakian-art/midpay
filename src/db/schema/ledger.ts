import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, ugx, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * transactions — the immutable financial ledger (§3, §2.4). This is the single
 * most portability-sensitive table: STANDARD, PORTABLE SQL ONLY. ~200 bytes/row
 * → ~50M rows fits D1's ceiling (decades of runway, §2.4).
 *
 * A row records one purchase: a recorded-content unlock (70/30, §3.2) or a live
 * ticket (volume-tiered split + §3.3 floor). All split math is snapshotted at
 * transaction time so historical rows are always reconstructable even after the
 * config (§7.2) changes. Amounts are whole UGX.
 *
 * RETENTION: ledger rows are NEVER deleted — even when the underlying media is
 * hard-deleted (§4.5.5). Required for payouts, tax (URA), and disputes.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: uuidPk(),

    type: text("type", { enum: ["video_unlock", "live_ticket"] }).notNull(),

    buyerId: uuidRef("buyer_id").notNull(), // users.id
    creatorId: uuidRef("creator_id").notNull(), // creators.id — payee

    // Exactly one of these is set, matching `type`.
    contentId: uuidRef("content_id"),
    liveEventId: uuidRef("live_event_id"),

    // --- Money breakdown (snapshotted; §3.2 simulation) ---
    grossUgx: ugx("gross_ugx").notNull(), // ticket price paid
    flutterwaveFeeUgx: ugx("flutterwave_fee_ugx").notNull(), // 3% collection fee
    netPoolUgx: ugx("net_pool_ugx").notNull(), // gross - fee
    creatorShareUgx: ugx("creator_share_ugx").notNull(),
    platformShareUgx: ugx("platform_share_ugx").notNull(),

    // Split snapshot: creator share in basis points (7000 = 70.00%) and, for
    // live, the concurrent-viewer band that selected the tier (§3.2 matrix).
    creatorSplitBps: integer("creator_split_bps").notNull(),
    liveViewerTier: text("live_viewer_tier", {
      enum: ["tier_1_200", "tier_201_500", "tier_501_plus"],
    }),

    // --- Payment lifecycle (§3.1 Flutterwave STK Push + webhook) ---
    // 'pending' | 'paid' | 'failed' | 'refunded'
    paymentStatus: text("payment_status", {
      enum: ["pending", "paid", "failed", "refunded"],
    })
      .notNull()
      .default("pending"),
    // Idempotent gateway reference (dedupes webhook retries).
    flutterwaveTxRef: text("flutterwave_tx_ref"),
    flutterwaveFlwId: text("flutterwave_flw_id"),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    refundedAt: integer("refunded_at", { mode: "timestamp" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("transactions_tx_ref_uq").on(t.flutterwaveTxRef),
    index("transactions_buyer_idx").on(t.buyerId),
    index("transactions_creator_idx").on(t.creatorId),
    index("transactions_status_idx").on(t.paymentStatus),
  ],
);

/**
 * entitlements — the access key that grants a buyer access to a paid item
 * (§3.1 "toggle content access keys"). Separate from `transactions` so access
 * can be revoked (hard-delete, §4.5.5) WITHOUT touching the retained ledger.
 * Backed by exactly one paid transaction.
 */
export const entitlements = sqliteTable(
  "entitlements",
  {
    id: uuidPk(),
    userId: uuidRef("user_id").notNull(),
    transactionId: uuidRef("transaction_id").notNull(),

    // Mirrors the transaction target for fast access checks.
    contentId: uuidRef("content_id"),
    liveEventId: uuidRef("live_event_id"),

    // 'active' | 'revoked' (revoked on hard-delete of a paid item, §4.5.5).
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    grantedAt: createdAt(),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("entitlements_user_content_uq").on(t.userId, t.contentId),
    uniqueIndex("entitlements_user_live_uq").on(t.userId, t.liveEventId),
    index("entitlements_user_idx").on(t.userId),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Entitlement = typeof entitlements.$inferSelect;
