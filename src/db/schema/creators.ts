import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * creators — a creator profile attached 1:1 to a user (§7.3 Creator Management).
 * Holds KYC state, payout account, verification, account standing (drives the
 * free-content allowance multipliers, §4.5.3) and optional per-creator revenue
 * split override (§3.2 / §7.2 — e.g. the three launch influencers).
 */
export const creators = sqliteTable(
  "creators",
  {
    id: uuidPk(),
    userId: uuidRef("user_id").notNull(),

    // KYC / onboarding queue (§7.3): 'pending' | 'approved' | 'rejected'
    kycStatus: text("kyc_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    kycReviewedBy: uuidRef("kyc_reviewed_by"), // admin_users.id
    kycReviewedAt: integer("kyc_reviewed_at", { mode: "timestamp" }),
    kycRejectionReason: text("kyc_rejection_reason"),

    // Payout destination — the mobile-money account payouts are sent to (§7.5).
    payoutMsisdn: text("payout_msisdn"),
    payoutProvider: text("payout_provider"), // e.g. 'mtn' | 'airtel'

    verified: integer("verified", { mode: "boolean" }).notNull().default(false),

    // Account standing drives free-content allowance multipliers (§4.5.3).
    // 'new' | 'verified' | 'trusted' | 'restricted'
    standing: text("standing", {
      enum: ["new", "verified", "trusted", "restricted"],
    })
      .notNull()
      .default("new"),

    // Per-creator revenue-split override (§7.2). NULL = use the global matrix.
    // Stored as basis points of the creator's share, e.g. 7000 = 70.00%.
    recordedSplitBpsOverride: integer("recorded_split_bps_override"),
    liveSplitBpsOverride: integer("live_split_bps_override"),

    // Moderation: 'active' | 'suspended' | 'banned'
    status: text("status", {
      enum: ["active", "suspended", "banned"],
    })
      .notNull()
      .default("active"),
    suspensionReason: text("suspension_reason"),
    strikeCount: integer("strike_count").notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("creators_user_uq").on(t.userId)],
);

export type Creator = typeof creators.$inferSelect;
export type NewCreator = typeof creators.$inferInsert;
