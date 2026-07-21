import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, ugx, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * wallets — per-creator running balance (§7.5). The balance is a cached
 * aggregate; `wallet_entries` is the authoritative double-checkable history.
 * Portable SQL only (financial table, §2.4).
 */
export const wallets = sqliteTable(
  "wallets",
  {
    id: uuidPk(),
    creatorId: uuidRef("creator_id").notNull(),
    // Available to pay out (credited from settled sales, minus paid-out/held).
    balanceUgx: ugx("balance_ugx").notNull().default(0),
    // Held back (manual hold / dispute / pending payout batch).
    heldUgx: ugx("held_ugx").notNull().default(0),
    lifetimeEarnedUgx: ugx("lifetime_earned_ugx").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("wallets_creator_uq").on(t.creatorId)],
);

/**
 * wallet_entries — append-only credit/debit journal against a wallet.
 * A sale credits the creator share; a payout debits it; refunds/holds/manual
 * adjustments each get a typed row. `balanceAfterUgx` snapshots the running
 * balance for auditability.
 */
export const walletEntries = sqliteTable(
  "wallet_entries",
  {
    id: uuidPk(),
    walletId: uuidRef("wallet_id").notNull(),
    // 'sale_credit' | 'payout_debit' | 'refund_debit' | 'hold' | 'release' | 'adjustment'
    type: text("type", {
      enum: [
        "sale_credit",
        "payout_debit",
        "refund_debit",
        "hold",
        "release",
        "adjustment",
      ],
    }).notNull(),
    // Signed amount (positive = credit, negative = debit), whole UGX.
    amountUgx: ugx("amount_ugx").notNull(),
    balanceAfterUgx: ugx("balance_after_ugx").notNull(),
    // Provenance links (nullable — depends on entry type).
    transactionId: uuidRef("transaction_id"),
    payoutId: uuidRef("payout_id"),
    memo: text("memo"),
    // For manual adjustments (§7.8) — which admin did it (audit).
    createdByAdminId: uuidRef("created_by_admin_id"),
    createdAt: createdAt(),
  },
  (t) => [index("wallet_entries_wallet_idx").on(t.walletId, t.createdAt)],
);

/**
 * payout_batches — a weekly "Payout Fridays" run (§5, §7.5). One batch groups
 * many per-creator payouts executed via Flutterwave bulk transfer.
 */
export const payoutBatches = sqliteTable("payout_batches", {
  id: uuidPk(),
  // 'draft' | 'approved' | 'executing' | 'completed' | 'failed'
  status: text("status", {
    enum: ["draft", "approved", "executing", "completed", "failed"],
  })
    .notNull()
    .default("draft"),
  minPayoutThresholdUgx: ugx("min_payout_threshold_ugx").notNull().default(0),
  totalAmountUgx: ugx("total_amount_ugx").notNull().default(0),
  payoutCount: integer("payout_count").notNull().default(0),
  approvedByAdminId: uuidRef("approved_by_admin_id"),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  executedAt: integer("executed_at", { mode: "timestamp" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * payouts — a single creator's payout within a batch (§7.5). Captures the
 * 0.5% mobile-money withdrawal duty per transfer (§6.5).
 */
export const payouts = sqliteTable(
  "payouts",
  {
    id: uuidPk(),
    batchId: uuidRef("batch_id").notNull(),
    creatorId: uuidRef("creator_id").notNull(),
    walletId: uuidRef("wallet_id").notNull(),

    grossUgx: ugx("gross_ugx").notNull(), // amount drawn from wallet
    withdrawalDutyUgx: ugx("withdrawal_duty_ugx").notNull().default(0), // 0.5%
    netUgx: ugx("net_ugx").notNull(), // actually sent to the creator

    // Snapshot of the destination at execution time.
    payoutMsisdn: text("payout_msisdn"),
    payoutProvider: text("payout_provider"),

    // 'pending' | 'held' | 'sent' | 'failed'
    status: text("status", {
      enum: ["pending", "held", "sent", "failed"],
    })
      .notNull()
      .default("pending"),
    flutterwaveTransferId: text("flutterwave_transfer_id"),
    failureReason: text("failure_reason"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payouts_batch_idx").on(t.batchId),
    index("payouts_creator_idx").on(t.creatorId),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type WalletEntry = typeof walletEntries.$inferSelect;
export type PayoutBatch = typeof payoutBatches.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
