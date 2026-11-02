import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { creators, users, payoutBatches, payouts, type Payout, type PayoutBatch } from "../db/schema";

type NewPayoutRow = typeof payouts.$inferInsert;

export class PayoutRepository {
  constructor(private readonly db: Database) {}

  findById(id: string) { return this.db.select().from(payouts).where(eq(payouts.id, id)).get(); }

  pendingCreatorWithdrawals() {
    return this.db.select().from(payouts).where(sql`${payouts.id} like 'cw_%' and ${payouts.status}='pending'`)
      .orderBy(asc(payouts.updatedAt)).limit(20).all();
  }

  listForCreator(creatorId: string) {
    return this.db.select().from(payouts).where(eq(payouts.creatorId, creatorId)).orderBy(desc(payouts.createdAt)).limit(50).all();
  }

  async ensureWithdrawalBatch(id: string, threshold: number) {
    await this.db.insert(payoutBatches).values({ id, minPayoutThresholdUgx: threshold }).onConflictDoNothing().run();
  }

  claimBatch(id: string): Promise<PayoutBatch | undefined> {
    return this.db.update(payoutBatches).set({ status: "executing" })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.status, "approved"))).returning().get();
  }

  claimPayout(id: string, requireVerifiedPhone = true): Promise<Payout | undefined> {
    return this.db.update(payouts).set({ status: "held" })
      .where(sql`${payouts.id} = ${id} and ${payouts.status} = 'pending'
        and ${payouts.netUgx} > 0
        and exists (select 1 from ${payoutBatches} where ${payoutBatches.id} = ${payouts.batchId} and ${payoutBatches.status} = 'executing')
        and exists (select 1 from ${creators} inner join ${users} on ${users.id} = ${creators.userId}
          where ${creators.id} = ${payouts.creatorId} and ${creators.status} = 'active' and ${users.status} = 'active'
          and ${users.phone} = ${payouts.payoutMsisdn}
          and ${creators.payoutProvider} is ${payouts.payoutProvider}
          and (${requireVerifiedPhone ? 0 : 1} or ${users.phoneVerifiedAt} is not null))`).returning().get();
  }

  awaitingReconciliation(): Promise<Payout[]> {
    return this.db.select().from(payouts).where(eq(payouts.status, "held"))
      .orderBy(asc(payouts.updatedAt), asc(payouts.id)).limit(20).all();
  }

  deferReconciliation(id: string): Promise<unknown> {
    return this.db.update(payouts).set({ updatedAt: new Date() })
      .where(and(eq(payouts.id, id), eq(payouts.status, "held"))).run();
  }

  completeBatchIfFinished(id: string): Promise<PayoutBatch | undefined> {
    return this.db.update(payoutBatches).set({ status: "completed", executedAt: new Date() })
      .where(sql`${payoutBatches.id} = ${id} and ${payoutBatches.status} = 'executing' and not exists
        (select 1 from ${payouts} where ${payouts.batchId} = ${id} and ${payouts.status} in ('pending', 'held'))`).returning().get();
  }

  approve(id: string, adminId: string | null): Promise<PayoutBatch | undefined> {
    return this.db.update(payoutBatches).set({ status: "approved", approvedByAdminId: adminId, approvedAt: new Date(),
      totalAmountUgx: sql`(select coalesce(sum(${payouts.grossUgx}), 0) from ${payouts} where ${payouts.batchId} = ${id})`,
      payoutCount: sql`(select count(*) from ${payouts} where ${payouts.batchId} = ${id})`,
    })
      .where(and(eq(payoutBatches.id, id), eq(payoutBatches.status, "draft"))).returning().get();
  }

  createBatch(row: {
    minPayoutThresholdUgx: number;
    status?: PayoutBatch["status"];
  }): Promise<PayoutBatch> {
    return this.db.insert(payoutBatches).values(row).returning().get();
  }

  getBatch(id: string): Promise<PayoutBatch | undefined> {
    return this.db.select().from(payoutBatches).where(eq(payoutBatches.id, id)).get();
  }

  listBatches(): Promise<PayoutBatch[]> {
    return this.db
      .select()
      .from(payoutBatches)
      .orderBy(desc(payoutBatches.createdAt))
      .all();
  }

  updateBatch(id: string, patch: Partial<PayoutBatch>): Promise<PayoutBatch> {
    return this.db
      .update(payoutBatches)
      .set(patch)
      .where(eq(payoutBatches.id, id))
      .returning()
      .get();
  }

  createPayout(row: NewPayoutRow): Promise<Payout> {
    return this.db.insert(payouts).values(row).returning().get();
  }

  listByBatch(batchId: string): Promise<Payout[]> {
    return this.db.select().from(payouts).where(eq(payouts.batchId, batchId)).all();
  }

  updatePayout(id: string, patch: Partial<Payout>): Promise<Payout> {
    return this.db.update(payouts).set(patch).where(eq(payouts.id, id)).returning().get();
  }
}
