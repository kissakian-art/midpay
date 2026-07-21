import type { Payout, PayoutBatch } from "../db/schema";
import { AuditRepository } from "../repositories/audit.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { PayoutRepository } from "../repositories/payout.repository";
import { UserRepository } from "../repositories/user.repository";
import { WalletRepository } from "../repositories/wallet.repository";
import { ConfigService } from "./config.service";
import { badRequest, notFound } from "./errors";
import { FlutterwaveClient } from "./payments/flutterwave";

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
  ) {}

  /** Build a draft batch, reserving funds for every eligible creator. */
  async buildBatch(
    adminId: string,
    opts: { minPayoutThresholdUgx?: number } = {},
  ): Promise<BatchWithPayouts> {
    const threshold = opts.minPayoutThresholdUgx ?? (await this.config.minPayoutThresholdUgx());
    const dutyPct = await this.config.withdrawalDutyPercent();
    const eligible = await this.wallets.eligibleForPayout(threshold);

    const batch = await this.payouts.createBatch({ minPayoutThresholdUgx: threshold });

    const created: Payout[] = [];
    let total = 0;
    for (const wallet of eligible) {
      const creator = await this.creators.findById(wallet.creatorId);
      if (!creator) continue;
      // Payout destination is ALWAYS the phone number the creator registered
      // with (Betpawa-style: the registration number is the money number).
      // No separately-set payout number — removes a whole fraud vector.
      const user = await this.users.findById(creator.userId);
      if (!user) continue;

      const gross = wallet.balanceUgx;
      const duty = Math.round((gross * dutyPct) / 100);
      const net = gross - duty;

      const payout = await this.payouts.createPayout({
        batchId: batch.id,
        creatorId: wallet.creatorId,
        walletId: wallet.id,
        grossUgx: gross,
        withdrawalDutyUgx: duty,
        netUgx: net,
        payoutMsisdn: user.phone,
        payoutProvider: creator.payoutProvider,
        status: "pending",
      });
      await this.wallets.hold(wallet.id, gross, payout.id);
      created.push(payout);
      total += gross;
    }

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
    const updated = await this.payouts.updateBatch(batchId, {
      status: "approved",
      approvedByAdminId: adminId,
      approvedAt: new Date(),
    });
    await this.audit.record({
      adminId,
      action: "payout.batch.approve",
      targetType: "payout_batch",
      targetId: batchId,
    });
    return updated;
  }

  /** Execute an approved batch via Flutterwave transfers. */
  async executeBatch(adminId: string, batchId: string): Promise<BatchWithPayouts> {
    const batch = await this.mustGetBatch(batchId);
    if (batch.status !== "approved") {
      throw badRequest("bad_state", `cannot execute a ${batch.status} batch`);
    }
    await this.payouts.updateBatch(batchId, { status: "executing" });

    const rows = await this.payouts.listByBatch(batchId);
    let sent = 0;
    let failed = 0;
    for (const p of rows) {
      if (p.status !== "pending") continue;
      const result = await this.flw.initiateTransfer({
        reference: p.id,
        amountUgx: p.netUgx,
        msisdn: p.payoutMsisdn ?? "",
        provider: p.payoutProvider ?? undefined,
      });

      if (result.status === "success") {
        await this.payouts.updatePayout(p.id, {
          status: "sent",
          flutterwaveTransferId: result.transferId,
        });
        await this.wallets.finalizeDebit(p.walletId, p.grossUgx, p.id);
        sent++;
      } else {
        await this.payouts.updatePayout(p.id, {
          status: "failed",
          failureReason: "transfer_declined",
        });
        await this.wallets.releaseHold(p.walletId, p.grossUgx, p.id);
        failed++;
      }
    }

    const updated = await this.payouts.updateBatch(batchId, {
      status: "completed",
      executedAt: new Date(),
    });
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
