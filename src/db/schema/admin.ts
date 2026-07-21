import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createdAt, updatedAt, uuidPk, uuidRef } from "./_shared";

/**
 * admin_users — operators of the Platform Administration Console (§7.1).
 * RBAC roles: Super Admin, Finance, Moderator, Support, Read-only Analyst.
 * Mandatory 2FA (§7.1) — `totpSecret`/`totpEnabled` back that requirement.
 * Separate from `users` (mobile app accounts) by design.
 */
export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: uuidPk(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    passwordHash: text("password_hash").notNull(),

    role: text("role", {
      enum: ["super_admin", "finance", "moderator", "support", "analyst"],
    }).notNull(),

    totpSecret: text("totp_secret"),
    totpEnabled: integer("totp_enabled", { mode: "boolean" })
      .notNull()
      .default(false),

    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("admin_users_email_uq").on(t.email)],
);

/**
 * audit_log — IMMUTABLE record of every admin action, especially config changes
 * and money movements (§7.1, §7.9). Append-only: no update/delete paths in the
 * service layer. Kept portable for the compliance export requirement.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: uuidPk(),
    adminId: uuidRef("admin_id"), // NULL = system-generated action
    action: text("action").notNull(), // e.g. 'creator.approve', 'config.update'
    targetType: text("target_type"), // e.g. 'creator', 'payout_batch', 'config'
    targetId: uuidRef("target_id"),
    // JSON blob of before/after or action detail (small; big data → R2/Analytics).
    detailJson: text("detail_json"),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_admin_idx").on(t.adminId, t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
  ],
);

/**
 * platform_config — versioned, effective-dated business rules (§7.2). Rather
 * than a single mutable row per key, each change appends a new row with an
 * `effectiveFrom`, so the rules in force at any past moment are reconstructable
 * ("versioned and effective-dated", §7.2). The current value for a key is the
 * latest row with effectiveFrom ≤ now.
 *
 * Keys include: LIVE_MIN_PRICE_PER_HOUR, STREAMING_COST_PER_VIEWER_MINUTE,
 * RECORDED_PRICE_FLOOR, the revenue-split matrix, free-content allowance
 * (free-minutes), free-upload rate limit, per-standing multipliers, feature
 * flags, and grace periods (§3.3, §4.5.3, §7.2). Values are JSON-encoded.
 */
export const platformConfig = sqliteTable(
  "platform_config",
  {
    id: uuidPk(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull(),
    createdByAdminId: uuidRef("created_by_admin_id"),
    createdAt: createdAt(),
  },
  (t) => [index("platform_config_key_idx").on(t.key, t.effectiveFrom)],
);

/**
 * moderation_reports — the review queue for reported/flagged uploads, streams,
 * and users (§7.4). Kill-switch / takedown outcomes are recorded via the
 * audit_log; this table holds the queue state.
 */
export const moderationReports = sqliteTable(
  "moderation_reports",
  {
    id: uuidPk(),
    reporterUserId: uuidRef("reporter_user_id"), // NULL = system-flagged
    targetType: text("target_type", {
      enum: ["content", "live_event", "comment", "user"],
    }).notNull(),
    targetId: uuidRef("target_id").notNull(),
    reason: text("reason"),
    // 'open' | 'reviewing' | 'actioned' | 'dismissed'
    status: text("status", {
      enum: ["open", "reviewing", "actioned", "dismissed"],
    })
      .notNull()
      .default("open"),
    resolvedByAdminId: uuidRef("resolved_by_admin_id"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("moderation_reports_status_idx").on(t.status),
    index("moderation_reports_target_idx").on(t.targetType, t.targetId),
  ],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type PlatformConfig = typeof platformConfig.$inferSelect;
export type ModerationReport = typeof moderationReports.$inferSelect;
