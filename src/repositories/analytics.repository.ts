import { and, desc, eq, gt, gte, lte, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { content, transactions } from "../db/schema";

export interface PaidTotals {
  count: number;
  grossUgx: number;
  feeUgx: number;
  netPoolUgx: number;
  creatorShareUgx: number;
  platformShareUgx: number;
}

export interface TypeBreakdown {
  type: string;
  count: number;
  grossUgx: number;
  platformShareUgx: number;
}

/**
 * AnalyticsRepository — read-only aggregates over the paid ledger (§7.7). Small,
 * summarized reads; the raw view/analytics firehose lives in Analytics Engine,
 * not D1 (§2.4).
 */
export class AnalyticsRepository {
  constructor(private readonly db: Database) {}

  private paidWindow(from?: Date, to?: Date): SQL {
    const conds: SQL[] = [eq(transactions.paymentStatus, "paid")];
    if (from) conds.push(gte(transactions.paidAt, from));
    if (to) conds.push(lte(transactions.paidAt, to));
    return and(...conds)!;
  }

  async paidTotals(from?: Date, to?: Date): Promise<PaidTotals> {
    const row = await this.db
      .select({
        count: sql<number>`count(*)`,
        grossUgx: sql<number>`coalesce(sum(${transactions.grossUgx}), 0)`,
        feeUgx: sql<number>`coalesce(sum(${transactions.flutterwaveFeeUgx}), 0)`,
        netPoolUgx: sql<number>`coalesce(sum(${transactions.netPoolUgx}), 0)`,
        creatorShareUgx: sql<number>`coalesce(sum(${transactions.creatorShareUgx}), 0)`,
        platformShareUgx: sql<number>`coalesce(sum(${transactions.platformShareUgx}), 0)`,
      })
      .from(transactions)
      .where(this.paidWindow(from, to))
      .get();
    return (
      row ?? {
        count: 0,
        grossUgx: 0,
        feeUgx: 0,
        netPoolUgx: 0,
        creatorShareUgx: 0,
        platformShareUgx: 0,
      }
    );
  }

  byType(from?: Date, to?: Date): Promise<TypeBreakdown[]> {
    return this.db
      .select({
        type: transactions.type,
        count: sql<number>`count(*)`,
        grossUgx: sql<number>`coalesce(sum(${transactions.grossUgx}), 0)`,
        platformShareUgx: sql<number>`coalesce(sum(${transactions.platformShareUgx}), 0)`,
      })
      .from(transactions)
      .where(this.paidWindow(from, to))
      .groupBy(transactions.type)
      .all();
  }

  topCreators(limit: number, from?: Date, to?: Date) {
    return this.db
      .select({
        creatorId: transactions.creatorId,
        salesCount: sql<number>`count(*)`,
        grossUgx: sql<number>`coalesce(sum(${transactions.grossUgx}), 0)`,
        creatorEarnedUgx: sql<number>`coalesce(sum(${transactions.creatorShareUgx}), 0)`,
      })
      .from(transactions)
      .where(this.paidWindow(from, to))
      .groupBy(transactions.creatorId)
      .orderBy(desc(sql`sum(${transactions.grossUgx})`))
      .limit(limit)
      .all();
  }

  topContent(limit: number) {
    return this.db
      .select({
        id: content.id,
        title: content.title,
        purchaseCount: content.purchaseCount,
      })
      .from(content)
      .where(gt(content.purchaseCount, 0))
      .orderBy(desc(content.purchaseCount))
      .limit(limit)
      .all();
  }
}
