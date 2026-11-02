import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "../db/client";
import { content, creators, entitlements, liveEvents, payoutBatches, payouts, transactions, users, walletEntries, wallets } from "../db/schema";

// INSERT SELECT includes every column; use explicit values rather than relying
// on app-side defaults. Keeping SQL inside repositories preserves the boundary.
export function selectRow(table: AnySQLiteTable, values: Record<string, SQL>, source: SQL): SQL {
  return sql`select ${sql.join(Object.keys(getTableColumns(table)).map((key) => values[key] ?? sql`null`), sql`, `)} ${source}`;
}

/** Each operation is a D1 atomic batch. Its state change is LAST, and every
 * preceding write checks that state, so concurrent calls/retries are no-ops. */
export class FinancialRepository {
  constructor(private readonly db: Database) {}

  async settle(transactionId: string, providerId?: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const eligible = sql`${transactions.id} = ${transactionId} and ${transactions.paymentStatus} in ('pending', 'failed')`;
    const exists = sql`exists (select 1 from ${transactions} where ${eligible})`;
    const fromTx = sql`from ${transactions} where ${eligible}`;
    const fromWallet = sql`from ${wallets} inner join ${transactions} on ${wallets.creatorId} = ${transactions.creatorId} where ${eligible}`;
    await this.db.batch([
      this.db.insert(wallets).select(selectRow(wallets, {
        id: sql`${crypto.randomUUID()}`, creatorId: sql`${transactions.creatorId}`,
        balanceUgx: sql`0`, heldUgx: sql`0`, lifetimeEarnedUgx: sql`0`, createdAt: sql`${now}`, updatedAt: sql`${now}`,
      }, fromTx)).onConflictDoNothing({ target: wallets.creatorId }),
      this.db.insert(walletEntries).select(selectRow(walletEntries, {
        id: sql`${crypto.randomUUID()}`, walletId: sql`${wallets.id}`, type: sql`'sale_credit'`,
        amountUgx: sql`${transactions.creatorShareUgx}`, balanceAfterUgx: sql`${wallets.balanceUgx} + ${transactions.creatorShareUgx}`,
        transactionId: sql`${transactions.id}`, createdAt: sql`${now}`,
      }, fromWallet)),
      this.db.update(wallets).set({
        balanceUgx: sql`${wallets.balanceUgx} + (select ${transactions.creatorShareUgx} from ${transactions} where ${transactions.id} = ${transactionId})`,
        lifetimeEarnedUgx: sql`${wallets.lifetimeEarnedUgx} + (select ${transactions.creatorShareUgx} from ${transactions} where ${transactions.id} = ${transactionId})`,
      }).where(sql`${exists} and ${wallets.creatorId} = (select ${transactions.creatorId} from ${transactions} where ${transactions.id} = ${transactionId})`),
      this.db.insert(entitlements).select(selectRow(entitlements, {
        id: sql`${crypto.randomUUID()}`, userId: sql`${transactions.buyerId}`, transactionId: sql`${transactions.id}`,
        contentId: sql`${transactions.contentId}`, liveEventId: sql`${transactions.liveEventId}`,
        status: sql`case when ${transactions.contentId} is not null and not exists (select 1 from ${content} where ${content.id} = ${transactions.contentId} and ${content.status} <> 'deleted') then 'revoked' else 'active' end`,
        grantedAt: sql`${now}`,
      }, fromTx)).onConflictDoNothing(),
      this.db.update(content).set({ purchaseCount: sql`${content.purchaseCount} + 1` })
        .where(sql`${exists} and ${content.id} = (select ${transactions.contentId} from ${transactions} where ${transactions.id} = ${transactionId})`),
      this.db.update(liveEvents).set({ ticketsSold: sql`${liveEvents.ticketsSold} + 1` })
        .where(sql`${exists} and ${liveEvents.id} = (select ${transactions.liveEventId} from ${transactions} where ${transactions.id} = ${transactionId})`),
      this.db.update(transactions).set({ paymentStatus: "paid", paidAt: new Date(), flutterwaveFlwId: providerId })
        .where(eligible),
    ]);
  }

  /** Reserve the current available balance and create its payout together. */
  async reservePayout(params: { batchId: string; walletId: string; phone: string; provider: string | null; dutyPercent: number; threshold: number;
    amountUgx?: number; payoutId?: string; fixedFeeUgx?: number; requireVerifiedPhone?: boolean }): Promise<void> {
    const id = params.payoutId ?? crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const amount = params.amountUgx === undefined ? sql`${wallets.balanceUgx}` : sql`${params.amountUgx}`;
    const duty = sql`cast(round(${amount} * ${params.dutyPercent} / 100) as integer) + ${params.fixedFeeUgx ?? 0}`;
    const source = sql`from ${wallets} where ${wallets.id} = ${params.walletId} and ${wallets.balanceUgx} > 0 and ${wallets.balanceUgx} >= ${params.threshold}
      and exists (select 1 from ${payoutBatches} where ${payoutBatches.id} = ${params.batchId} and ${payoutBatches.status} = 'draft')
      and ${amount} > ${duty} and ${amount} >= ${params.threshold} and ${wallets.balanceUgx} >= ${amount}
      and (${params.payoutId ? 0 : 1} or not exists (select 1 from ${payouts}
        where ${payouts.creatorId} = ${wallets.creatorId} and ${payouts.status} in ('pending', 'held')))
      and ${wallets.balanceUgx} - ${amount} >= (select coalesce(sum(${transactions.creatorShareUgx}), 0) from ${transactions}
        inner join ${liveEvents} on ${liveEvents.id} = ${transactions.liveEventId}
        where ${transactions.creatorId} = ${wallets.creatorId} and ${transactions.paymentStatus} = 'paid' and ${liveEvents.status} <> 'ended')
      and exists (select 1 from ${creators} inner join ${users} on ${users.id} = ${creators.userId}
        where ${creators.id} = ${wallets.creatorId} and ${creators.status} = 'active' and ${users.status} = 'active' and ${users.phone} = ${params.phone}
          and ${creators.payoutProvider} is ${params.provider}
          and (${params.requireVerifiedPhone ? 0 : 1} or ${users.phoneVerifiedAt} is not null))`;
    const reserved = sql`exists (select 1 from ${payouts} where ${payouts.id} = ${id})`;
    const gross = sql`(select ${payouts.grossUgx} from ${payouts} where ${payouts.id} = ${id})`;
    await this.db.batch([
      this.db.insert(payouts).select(selectRow(payouts, {
        id: sql`${id}`, batchId: sql`${params.batchId}`, creatorId: sql`${wallets.creatorId}`, walletId: sql`${wallets.id}`,
        grossUgx: amount, withdrawalDutyUgx: duty, netUgx: sql`${amount} - ${duty}`,
        payoutMsisdn: sql`${params.phone}`, payoutProvider: sql`${params.provider}`, status: sql`'pending'`, createdAt: sql`${now}`, updatedAt: sql`${now}`,
      }, source)),
      this.db.insert(walletEntries).select(selectRow(walletEntries, {
        id: sql`${crypto.randomUUID()}`, walletId: sql`${wallets.id}`, type: sql`'hold'`, amountUgx: sql`-${gross}`,
        balanceAfterUgx: sql`${wallets.balanceUgx} - ${gross}`, payoutId: sql`${id}`, createdAt: sql`${now}`,
      }, sql`from ${wallets} where ${wallets.id} = ${params.walletId} and ${reserved}`)),
      this.db.update(wallets).set({ balanceUgx: sql`${wallets.balanceUgx} - ${gross}`, heldUgx: sql`${wallets.heldUgx} + ${gross}` })
        .where(sql`${wallets.id} = ${params.walletId} and ${reserved}`),
    ]);
  }

  /** Finalize only confirmed provider outcomes. Unknown outcomes keep the hold. */
  async completePayout(id: string, success: boolean, providerId?: string): Promise<void> {
    return this.finalizePayout(id, success, "held", providerId);
  }

  /** Pending means no provider request has been claimed. Never release held transfers. */
  async cancelUnsubmittedPayout(id: string): Promise<void> {
    return this.finalizePayout(id, false, "pending");
  }

  private async finalizePayout(id: string, success: boolean, expected: "pending" | "held", providerId?: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const eligible = sql`${payouts.id} = ${id} and ${payouts.status} = ${expected}`;
    const gross = sql`(select ${payouts.grossUgx} from ${payouts} where ${payouts.id} = ${id})`;
    const guard = sql`exists (select 1 from ${payouts} where ${eligible})`;
    await this.db.batch([
      this.db.insert(walletEntries).select(selectRow(walletEntries, {
        id: sql`${crypto.randomUUID()}`, walletId: sql`${wallets.id}`, type: sql`${success ? "payout_debit" : "release"}`,
        amountUgx: success ? sql`-${payouts.grossUgx}` : sql`${payouts.grossUgx}`,
        balanceAfterUgx: success ? sql`${wallets.balanceUgx}` : sql`${wallets.balanceUgx} + ${payouts.grossUgx}`,
        payoutId: sql`${payouts.id}`, createdAt: sql`${now}`,
      }, sql`from ${wallets} inner join ${payouts} on ${wallets.id} = ${payouts.walletId} where ${eligible}`)),
      this.db.update(wallets).set({
        balanceUgx: success ? sql`${wallets.balanceUgx}` : sql`${wallets.balanceUgx} + ${gross}`,
        heldUgx: sql`${wallets.heldUgx} - ${gross}`,
      }).where(sql`${guard} and ${wallets.id} = (select ${payouts.walletId} from ${payouts} where ${payouts.id} = ${id})`),
      this.db.update(payouts).set({ status: success ? "sent" : "failed", flutterwaveTransferId: providerId,
        failureReason: expected === "pending" ? "cancelled_before_submission" : success ? null : "provider_confirmed_failure" })
        .where(eligible),
    ]);
  }
}
