import { and, eq, gt, gte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { wallets, type Wallet } from "../db/schema";

export class WalletRepository {
  constructor(private readonly db: Database) {}

  async pendingLiveUgx(creatorId: string): Promise<number> {
    const row = await this.db.get<{ amount: number }>(sql`select coalesce(sum(t.creator_share_ugx),0) as amount
      from transactions t join live_events l on l.id=t.live_event_id
      where t.creator_id=${creatorId} and t.payment_status='paid' and l.status <> 'ended'`);
    return row?.amount ?? 0;
  }

  findById(id: string): Promise<Wallet | undefined> {
    return this.db.select().from(wallets).where(eq(wallets.id, id)).get();
  }

  findByCreatorId(creatorId: string): Promise<Wallet | undefined> {
    return this.db.select().from(wallets).where(eq(wallets.creatorId, creatorId)).get();
  }

  /** All wallets with an available balance at/above a threshold (payout eligibility). */
  eligibleForPayout(minBalanceUgx: number): Promise<Wallet[]> {
    return this.db
      .select()
      .from(wallets)
      .where(and(gt(wallets.balanceUgx, 0), gte(wallets.balanceUgx, minBalanceUgx)))
      .all();
  }

  /** Platform-wide wallet totals for the float monitor (§7.5). */
  async totals(): Promise<{ available: number; held: number }> {
    const row = await this.db
      .select({
        available: sql<number>`coalesce(sum(${wallets.balanceUgx}), 0)`,
        held: sql<number>`coalesce(sum(${wallets.heldUgx}), 0)`,
      })
      .from(wallets)
      .get();
    return { available: row?.available ?? 0, held: row?.held ?? 0 };
  }

}
