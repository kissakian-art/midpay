import { and, eq, gt, gte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { wallets, walletEntries, type Wallet } from "../db/schema";

export class WalletRepository {
  constructor(private readonly db: Database) {}

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

  /** Get the creator's wallet, creating an empty one on first use. */
  async ensureForCreator(creatorId: string): Promise<Wallet> {
    const existing = await this.findByCreatorId(creatorId);
    if (existing) return existing;
    return this.db.insert(wallets).values({ creatorId }).returning().get();
  }

  /**
   * Credit a settled sale to the wallet: append a `sale_credit` journal entry
   * and bump the cached balance + lifetime total. Read-then-write; wrap the two
   * writes in a batch so they land together (§7.5).
   */
  async creditSale(params: {
    creatorId: string;
    amountUgx: number;
    transactionId: string;
  }): Promise<Wallet> {
    const wallet = await this.ensureForCreator(params.creatorId);
    const balanceAfter = wallet.balanceUgx + params.amountUgx;

    await this.db.batch([
      this.db.insert(walletEntries).values({
        walletId: wallet.id,
        type: "sale_credit",
        amountUgx: params.amountUgx,
        balanceAfterUgx: balanceAfter,
        transactionId: params.transactionId,
      }),
      this.db
        .update(wallets)
        .set({
          balanceUgx: balanceAfter,
          lifetimeEarnedUgx: wallet.lifetimeEarnedUgx + params.amountUgx,
        })
        .where(eq(wallets.id, wallet.id)),
    ]);

    return { ...wallet, balanceUgx: balanceAfter };
  }

  /**
   * Reserve funds for a pending payout: move `amountUgx` from available balance
   * into `held` and journal a `hold` entry. Called when a batch is built (§7.5).
   */
  async hold(walletId: string, amountUgx: number, payoutId: string): Promise<void> {
    const wallet = await this.mustFind(walletId);
    const balanceAfter = wallet.balanceUgx - amountUgx;
    if (balanceAfter < 0) throw new Error("insufficient balance to hold");
    await this.db.batch([
      this.db.insert(walletEntries).values({
        walletId,
        type: "hold",
        amountUgx: -amountUgx,
        balanceAfterUgx: balanceAfter,
        payoutId,
      }),
      this.db
        .update(wallets)
        .set({ balanceUgx: balanceAfter, heldUgx: wallet.heldUgx + amountUgx })
        .where(eq(wallets.id, walletId)),
    ]);
  }

  /** Finalize a paid-out hold: money has left the system (held ↓). */
  async finalizeDebit(walletId: string, amountUgx: number, payoutId: string): Promise<void> {
    const wallet = await this.mustFind(walletId);
    await this.db.batch([
      this.db.insert(walletEntries).values({
        walletId,
        type: "payout_debit",
        amountUgx: -amountUgx,
        balanceAfterUgx: wallet.balanceUgx,
        payoutId,
      }),
      this.db
        .update(wallets)
        .set({ heldUgx: Math.max(0, wallet.heldUgx - amountUgx) })
        .where(eq(wallets.id, walletId)),
    ]);
  }

  /** Return a failed hold to available balance (held ↓, balance ↑). */
  async releaseHold(walletId: string, amountUgx: number, payoutId: string): Promise<void> {
    const wallet = await this.mustFind(walletId);
    const balanceAfter = wallet.balanceUgx + amountUgx;
    await this.db.batch([
      this.db.insert(walletEntries).values({
        walletId,
        type: "release",
        amountUgx: amountUgx,
        balanceAfterUgx: balanceAfter,
        payoutId,
      }),
      this.db
        .update(wallets)
        .set({ balanceUgx: balanceAfter, heldUgx: Math.max(0, wallet.heldUgx - amountUgx) })
        .where(eq(wallets.id, walletId)),
    ]);
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

  private async mustFind(walletId: string): Promise<Wallet> {
    const wallet = await this.findById(walletId);
    if (!wallet) throw new Error(`wallet ${walletId} not found`);
    return wallet;
  }
}
