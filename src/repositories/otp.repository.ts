import { and, desc, eq, gt, isNull } from "drizzle-orm";
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

  markConsumed(id: string, now: Date): Promise<unknown> {
    return this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(eq(otpChallenges.id, id))
      .run();
  }

  incrementAttempts(id: string, attempts: number): Promise<unknown> {
    return this.db
      .update(otpChallenges)
      .set({ attempts })
      .where(eq(otpChallenges.id, id))
      .run();
  }
}
