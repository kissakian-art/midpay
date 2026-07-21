import { and, eq } from "drizzle-orm";
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
}
