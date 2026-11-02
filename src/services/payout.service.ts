import type { Payout, PayoutBatch } from "../db/schema";
import { AuditRepository } from "../repositories/audit.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { PayoutRepository } from "../repositories/payout.repository";
import { UserRepository } from "../repositories/user.repository";
import { WalletRepository } from "../repositories/wallet.repository";
import { ConfigService } from "./config.service";
import { ApiError, badRequest, notFound, forbidden, conflict } from "./errors";
import { FlutterwaveClient } from "./payments/flutterwave";
import { FinancialRepository } from "../repositories/financial.repository";
import type { Env } from "../env";

export interface BatchWithPayouts {
  batch: PayoutBatch;
  payouts: Payout[];
}

/**
 * PayoutService — "Payout Fridays" (§5, §7.5). Lifecycle:
 *   build  → reserve each eligible creator's balance into `held`, one pending
 *            payout row per creator (0.5% withdrawal duty deducted, §6.5).
 *   approve→ Finance/Super Admin signs off (draft → approved).
 *   execute→ fire Flutterwave transfers; on success finalize the debit, on
 *            failure release the hold back to available balance.
 * Every state change is written to the immutable audit log (§7.1).
 */
export class PayoutService {
  constructor(
    private readonly payouts: PayoutRepository,
    private readonly wallets: WalletRepository,
    private readonly creators: CreatorRepository,
    private readonly users: UserRepository,
    private readonly config: ConfigService,
    private readonly flw: FlutterwaveClient,
    private readonly audit: AuditRepository,
    private readonly financial: FinancialRepository,
    private readonly env: Env,
  ) {}

  private async withdrawalAccount(userId: string) {
    const creator = await this.creators.findByUserId(userId);
    const user = await this.users.findById(userId);
    if (!creator || creator.status !== 'active' || !user || user.status !== 'active') throw forbidden('An active creator account is required');
    return { creator, user };
  }

  async withdrawalOverview(userId: string) {
    const { creator, user } = await this.withdrawalAccount(userId);
    const [wallet, pendingLiveUgx, settings, history] = await Promise.all([
      this.wallets.findByCreatorId(creator.id), this.wallets.pendingLiveUgx(creator.id),
      this.config.withdrawalSettings(), this.payouts.listForCreator(creator.id),
    ]);
    return { ...settings, phone: user.phone, provider: creator.payoutProvider,
      pendingLiveUgx, eligibleUgx: Math.max(0, (wallet?.balanceUgx ?? 0) - pendingLiveUgx),
      processingUgx: wallet?.heldUgx ?? 0, history: history.map(p => this.publicWithdrawal(p)) };
  }

  private publicWithdrawal(p: Payout) {
    return { id: p.id, amountUgx: p.grossUgx, feeUgx: p.withdrawalDutyUgx, netUgx: p.netUgx,
      status: p.status, createdAt: p.createdAt };
  }

  async quoteWithdrawal(userId: string, amountUgx: number, provider: string) {
    const { user } = await this.withdrawalAccount(userId);
    if (this.env.ENVIRONMENT !== 'development' && !user.phoneVerifiedAt) throw forbidden('Verify your registered phone before withdrawing');
    if (provider !== 'mtn' && provider !== 'airtel') throw badRequest('invalid_network', 'Select MTN or Airtel');
    const overview = await this.withdrawalOverview(userId);
    if (!overview.enabled) throw new ApiError(503, 'withdrawals_disabled', 'Self-service withdrawals are not yet enabled');
    if (!Number.isSafeInteger(overview.minimumUgx) || overview.minimumUgx <= 0 || !Number.isSafeInteger(overview.fixedFeeUgx) || overview.fixedFeeUgx < 0 || !Number.isFinite(overview.percent) || overview.percent < 0 || overview.percent >= 100) {
      throw new ApiError(503, 'withdrawals_unconfigured', 'Withdrawal pricing is not configured');
    }
    if (!Number.isSafeInteger(amountUgx) || amountUgx < overview.minimumUgx || amountUgx > overview.eligibleUgx) throw badRequest('invalid_amount', 'Amount must meet the minimum and fit your eligible balance');
    const feeUgx = Math.round(amountUgx * overview.percent / 100) + overview.fixedFeeUgx;
    if (feeUgx >= amountUgx) throw badRequest('invalid_amount', 'Amount must exceed the withdrawal fee');
    return { requestId: crypto.randomUUID(), amountUgx, feeUgx, netUgx: amountUgx - feeUgx, phone: user.phone, provider };
  }

  async requestWithdrawal(userId: string, input: { requestId: string; amountUgx: number; feeUgx: number; provider: string }) {
    const { creator, user } = await this.withdrawalAccount(userId);
    if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw badRequest('invalid_request', 'A withdrawal request ID is required');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${input.requestId}`));
    const suffix = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const id = `cw_${suffix}`, batchId = `cb_${suffix}`;
    let payout = await this.payouts.findById(id);
    if (payout && (payout.creatorId !== creator.id || payout.grossUgx !== input.amountUgx || payout.withdrawalDutyUgx !== input.feeUgx || payout.payoutProvider !== input.provider)) throw conflict('request_reused', 'This request ID belongs to a different withdrawal');
    if (!payout) {
      const quote = await this.quoteWithdrawal(userId, input.amountUgx, input.provider);
      if (quote.feeUgx !== input.feeUgx) throw conflict('fee_changed', 'Withdrawal fee changed. Request a new quote.');
      const settings = await this.config.withdrawalSettings();
      const [balance, totals] = await Promise.all([this.flw.availablePayoutBalanceUgx(), this.wallets.totals()]);
      if (balance < input.amountUgx + totals.held) throw new ApiError(503, 'payout_funding', 'Withdrawals are temporarily awaiting funding. Your earnings remain safe.');
      if (!(await this.creators.setPayoutNetwork(userId, input.provider as 'mtn' | 'airtel'))) throw conflict('withdrawal_processing', 'Wait for your existing withdrawal to finish');
      const wallet = await this.wallets.findByCreatorId(creator.id);
      if (!wallet) throw badRequest('no_balance', 'No earnings available');
      await this.payouts.ensureWithdrawalBatch(batchId, settings.minimumUgx);
      try {
        await this.financial.reservePayout({ batchId, payoutId: id, walletId: wallet.id, phone: user.phone,
          provider: input.provider, amountUgx: input.amountUgx, dutyPercent: settings.percent,
          fixedFeeUgx: settings.fixedFeeUgx, threshold: settings.minimumUgx, requireVerifiedPhone: this.env.ENVIRONMENT !== 'development' });
      } catch (error) { if (!(await this.payouts.findById(id))) throw error; }
      payout = await this.payouts.findById(id);
      if (!payout) throw conflict('balance_changed', 'Balance changed or another withdrawal is processing. Refresh your earnings.');
    }
    if (payout.grossUgx !== input.amountUgx || payout.withdrawalDutyUgx !== input.feeUgx || payout.payoutProvider !== input.provider) throw conflict('request_reused', 'Request ID already used');
    // Durable reservation can be resumed using the same request ID; held requests are only verified.
    if (payout.status === 'pending') {
      if (!(await this.config.withdrawalSettings()).enabled) return this.publicWithdrawal(payout);
      await this.payouts.approve(batchId, null);
      await this.executeBatch(null, batchId);
    }
    return this.publicWithdrawal((await this.payouts.findById(id))!);
  }

  async resumeCreatorWithdrawals() {
    if (!(await this.config.withdrawalSettings()).enabled) return;
    for (const p of await this.payouts.pendingCreatorWithdrawals()) {
      try {
        if (await this.flw.availablePayoutBalanceUgx() < p.grossUgx) continue;
        await this.payouts.approve(p.batchId, null);
        await this.executeBatch(null, p.batchId);
      } catch { console.warn('creator withdrawal awaiting submission', p.id); }
    }
  }

  /** Build a draft batch, reserving funds for every eligible creator. */
  async buildBatch(
    adminId: string,
    opts: { minPayoutThresholdUgx?: number } = {},
  ): Promise<BatchWithPayouts> {
    const threshold = opts.minPayoutThresholdUgx ?? (await this.config.minPayoutThresholdUgx());
    const dutyPct = await this.config.withdrawalDutyPercent();
    if (!Number.isSafeInteger(threshold) || threshold < 0 || !Number.isFinite(dutyPct) || dutyPct < 0 || dutyPct >= 100) {
      throw badRequest("invalid_payout_config", "Invalid payout threshold or duty");
    }
    const eligible = await this.wallets.eligibleForPayout(threshold);

    const batch = await this.payouts.createBatch({ minPayoutThresholdUgx: threshold });

    for (const wallet of eligible) {
      const creator = await this.creators.findById(wallet.creatorId);
      if (!creator || creator.status !== "active") continue;
      // Payout destination is ALWAYS the phone number the creator registered
      // with (Betpawa-style: the registration number is the money number).
      // No separately-set payout number — removes a whole fraud vector.
      const user = await this.users.findById(creator.userId);
      if (!user || user.status !== "active" || (this.env.ENVIRONMENT !== "development" && !user.phoneVerifiedAt)) continue;
      await this.financial.reservePayout({ batchId: batch.id, walletId: wallet.id, phone: user.phone,
        provider: creator.payoutProvider, dutyPercent: dutyPct, threshold,
        amountUgx: Math.max(0, wallet.balanceUgx - await this.wallets.pendingLiveUgx(creator.id)) });
    }

    const created = await this.payouts.listByBatch(batch.id);
    const total = created.reduce((sum, row) => sum + row.grossUgx, 0);

    const updated = await this.payouts.updateBatch(batch.id, {
      payoutCount: created.length,
      totalAmountUgx: total,
    });
    await this.audit.record({
      adminId,
      action: "payout.batch.build",
      targetType: "payout_batch",
      targetId: batch.id,
      detail: { threshold, payoutCount: created.length, totalAmountUgx: total },
    });
    return { batch: updated, payouts: created };
  }

  async approveBatch(adminId: string, batchId: string): Promise<PayoutBatch> {
    const batch = await this.mustGetBatch(batchId);
    if (batch.status !== "draft") {
      throw badRequest("bad_state", `cannot approve a ${batch.status} batch`);
    }
    const rows = await this.payouts.listByBatch(batchId);
    if (rows.length === 0) throw badRequest("empty_batch", "This batch has no reserved payouts");
    const updated = await this.payouts.approve(batchId, adminId);
    if (!updated) throw badRequest("bad_state", "Batch has already been approved");
    await this.audit.record({
      adminId,
      action: "payout.batch.approve",
      targetType: "payout_batch",
      targetId: batchId,
    });
    return updated;
  }

  /** Execute an approved batch via Flutterwave transfers. */
  async executeBatch(adminId: string | null, batchId: string): Promise<BatchWithPayouts> {
    this.flw.assertReady();
    const batch = await this.mustGetBatch(batchId);
    if (batch.status !== "approved" && batch.status !== "executing") {
      throw badRequest("bad_state", `cannot execute a ${batch.status} batch`);
    }
    if (batch.status === "approved") await this.payouts.claimBatch(batchId);

    const rows = await this.payouts.listByBatch(batchId);
    let sent = 0;
    let failed = 0;
    for (const p of rows) {
      if (p.status !== "pending" && p.status !== "held") continue;
      try {
        let transferId = p.flutterwaveTransferId;
        if (p.status === "pending") {
          // Persist the claim BEFORE making the external request. A timeout or
          // process crash must never cause another transfer to be submitted.
          if (!(await this.payouts.claimPayout(p.id, this.env.ENVIRONMENT !== "development"))) continue;
          const initiated = await this.flw.initiateTransfer({ reference: p.id, amountUgx: p.netUgx,
            msisdn: p.payoutMsisdn ?? "", provider: p.payoutProvider ?? undefined });
          transferId = initiated.transferId ?? null;
          if (transferId) await this.payouts.updatePayout(p.id, { flutterwaveTransferId: transferId });
        }
        const result = await this.flw.verifyTransfer({ reference: p.id, transferId, amountUgx: p.netUgx, msisdn: p.payoutMsisdn ?? "" });
        if (result.status === "pending") continue;
        await this.financial.completePayout(p.id, result.status === "success", result.transferId);
        if (result.status === "success") sent++; else failed++;
      } catch {
        // Preserve the hold; executing the batch again reconciles by reference.
        // Do not log provider payloads or destination numbers.
        console.warn("payout awaiting reconciliation", p.id);
      }
    }

    const updated = (await this.payouts.completeBatchIfFinished(batchId)) ?? await this.mustGetBatch(batchId);
    await this.audit.record({
      adminId,
      action: "payout.batch.execute",
      targetType: "payout_batch",
      targetId: batchId,
      detail: { sent, failed },
    });
    return { batch: updated, payouts: await this.payouts.listByBatch(batchId) };
  }

  async getBatch(batchId: string): Promise<BatchWithPayouts> {
    const batch = await this.mustGetBatch(batchId);
    return { batch, payouts: await this.payouts.listByBatch(batchId) };
  }

  async cancelUnsubmitted(adminId: string, batchId: string): Promise<BatchWithPayouts> {
    const batch = await this.mustGetBatch(batchId);
    const rows = await this.payouts.listByBatch(batchId);
    for (const p of rows) await this.financial.cancelUnsubmittedPayout(p.id);
    await this.payouts.completeBatchIfFinished(batchId);
    await this.audit.record({ adminId, action: "payout.batch.cancel_unsubmitted",
      targetType: "payout_batch", targetId: batch.id });
    return this.getBatch(batchId);
  }

  /** Only verify previously claimed transfers: never submit money from cron. */
  async reconcilePending(batchId?: string): Promise<void> {
    if (!this.flw.isConfigured) return;
    this.flw.assertReady();
    const rows = batchId ? (await this.payouts.listByBatch(batchId)).filter(p => p.status === "held")
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id)).slice(0, 20)
      : await this.payouts.awaitingReconciliation();
    await Promise.all(rows.map(async (p) => {
      await this.payouts.deferReconciliation(p.id);
      try {
        const result = await this.flw.verifyTransfer({ reference: p.id,
          transferId: p.flutterwaveTransferId, amountUgx: p.netUgx, msisdn: p.payoutMsisdn ?? "" });
        if (result.status !== "pending") {
          await this.financial.completePayout(p.id, result.status === "success", result.transferId);
          await this.payouts.completeBatchIfFinished(p.batchId);
        }
      } catch {
        console.warn("payout awaiting reconciliation", p.id);
      }
    }));
  }

  async verifyBatch(adminId: string, batchId: string): Promise<BatchWithPayouts> {
    await this.mustGetBatch(batchId);
    await this.reconcilePending(batchId);
    await this.payouts.completeBatchIfFinished(batchId);
    await this.audit.record({ adminId, action: "payout.batch.verify", targetType: "payout_batch", targetId: batchId });
    return this.getBatch(batchId);
  }

  listBatches(): Promise<PayoutBatch[]> {
    return this.payouts.listBatches();
  }

  /** Float / reserve monitor (§7.5): outstanding creator obligations. */
  async floatSummary(): Promise<{ availableUgx: number; heldUgx: number; totalObligationUgx: number }> {
    const totals = await this.wallets.totals();
    return {
      availableUgx: totals.available,
      heldUgx: totals.held,
      totalObligationUgx: totals.available + totals.held,
    };
  }

  private async mustGetBatch(batchId: string): Promise<PayoutBatch> {
    const batch = await this.payouts.getBatch(batchId);
    if (!batch) throw notFound("payout batch");
    return batch;
  }
}
