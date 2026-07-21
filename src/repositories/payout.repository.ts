import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { payoutBatches, payouts, type Payout, type PayoutBatch } from "../db/schema";

type NewPayoutRow = typeof payouts.$inferInsert;

export class PayoutRepository {
  constructor(private readonly db: Database) {}

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
