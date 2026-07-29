import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { transactions, type NewTransaction, type Transaction } from "../db/schema";

export class TransactionRepository {
  constructor(private readonly db: Database) {}

  create(row: NewTransaction): Promise<Transaction> {
    return this.db.insert(transactions).values(row).returning().get();
  }

  findById(id: string): Promise<Transaction | undefined> {
    return this.db.select().from(transactions).where(eq(transactions.id, id)).get();
  }

  findByTxRef(txRef: string): Promise<Transaction | undefined> {
    return this.db
      .select()
      .from(transactions)
      .where(eq(transactions.flutterwaveTxRef, txRef))
      .get();
  }

  /** Does this buyer already hold a paid transaction for this target? */
  findPaidForTarget(
    buyerId: string,
    field: "contentId" | "liveEventId",
    targetId: string,
  ): Promise<Transaction | undefined> {
    const col =
      field === "contentId" ? transactions.contentId : transactions.liveEventId;
    return this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.buyerId, buyerId),
          eq(col, targetId),
          eq(transactions.paymentStatus, "paid"),
        ),
      )
      .get();
  }

  markPaid(
    id: string,
    patch: { flutterwaveFlwId?: string; paidAt: Date },
  ): Promise<Transaction | undefined> {
    return this.db
      .update(transactions)
      .set({ paymentStatus: "paid", ...patch })
      .where(eq(transactions.id, id))
      .returning()
      .get();
  }

  markFailed(id: string): Promise<unknown> {
    return this.db
      .update(transactions)
      .set({ paymentStatus: "failed" })
      .where(eq(transactions.id, id))
      .run();
  }

  // --- Creator analytics aggregates (paid sales only) ---

  /** Total creator-share earned + number of paid sales, optionally since a date. */
  async creatorEarnings(
    creatorId: string,
    since?: Date,
  ): Promise<{ totalUgx: number; salesCount: number }> {
    const conds = [
      eq(transactions.creatorId, creatorId),
      eq(transactions.paymentStatus, "paid"),
    ];
    if (since) conds.push(gte(transactions.paidAt, since));
    const row = await this.db
      .select({
        totalUgx: sql<number>`coalesce(sum(${transactions.creatorShareUgx}), 0)`,
        salesCount: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(and(...conds))
      .get();
    return { totalUgx: row?.totalUgx ?? 0, salesCount: row?.salesCount ?? 0 };
  }

  /** Paid recorded-content sales grouped by content id, optionally since a date. */
  async creatorSalesByContent(
    creatorId: string,
    since?: Date,
  ): Promise<{ contentId: string; salesCount: number; earningsUgx: number }[]> {
    const conds = [
      eq(transactions.creatorId, creatorId),
      eq(transactions.paymentStatus, "paid"),
      eq(transactions.type, "video_unlock"),
    ];
    if (since) conds.push(gte(transactions.paidAt, since));
    const rows = await this.db
      .select({
        contentId: transactions.contentId,
        salesCount: sql<number>`count(*)`,
        earningsUgx: sql<number>`coalesce(sum(${transactions.creatorShareUgx}), 0)`,
      })
      .from(transactions)
      .where(and(...conds))
      .groupBy(transactions.contentId)
      .all();
    return rows.flatMap((r) =>
      r.contentId ? [{ contentId: r.contentId, salesCount: r.salesCount, earningsUgx: r.earningsUgx }] : [],
    );
  }
}
