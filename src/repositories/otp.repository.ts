import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { otpChallenges, type OtpChallenge } from "../db/schema";

export class OtpRepository {
  constructor(private readonly db: Database) {}

  create(row: {
    phone: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<OtpChallenge> {
    return this.db.insert(otpChallenges).values(row).returning().get();
  }

  /** Latest unconsumed, unexpired challenge for a phone. */
  findActiveByPhone(phone: string, now: Date): Promise<OtpChallenge | undefined> {
    return this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phone, phone),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .get();
  }

  consume(id: string, now: Date, maxAttempts: number): Promise<OtpChallenge | undefined> {
    return this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, id), isNull(otpChallenges.consumedAt), gt(otpChallenges.expiresAt, now), lt(otpChallenges.attempts, maxAttempts)))
      .returning().get();
  }

  incrementAttempts(id: string): Promise<unknown> {
    return this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, id))
      .run();
  }
}
