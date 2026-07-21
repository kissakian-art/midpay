import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { createdAt, uuidPk } from "./_shared";

/**
 * otp_challenges — short-lived phone one-time-passcodes for login/signup
 * (§3.1 phone-centric identity). Transient, low-volume (login attempts, not a
 * firehose), so it's fine in D1. The code is stored HASHED, never in plaintext;
 * rows expire and are consumed on use. A cleanup pass can delete expired rows.
 */
export const otpChallenges = sqliteTable(
  "otp_challenges",
  {
    id: uuidPk(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(), // SHA-256 of the 6-digit code
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("otp_challenges_phone_idx").on(t.phone, t.createdAt)],
);

export type OtpChallenge = typeof otpChallenges.$inferSelect;
