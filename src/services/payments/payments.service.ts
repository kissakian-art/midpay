import type { Transaction } from "../../db/schema";
import { AuditRepository } from "../../repositories/audit.repository";
import { ContentRepository } from "../../repositories/content.repository";
import { CreatorRepository } from "../../repositories/creator.repository";
import { EntitlementRepository } from "../../repositories/entitlement.repository";
import { LiveRepository } from "../../repositories/live.repository";
import { TransactionRepository } from "../../repositories/transaction.repository";
import { UserRepository } from "../../repositories/user.repository";
import { FinancialRepository } from "../../repositories/financial.repository";
import { ConfigService } from "../config.service";
import { normalizePhone } from "../auth.service";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import {
  computeSplit,
  liveCreatorSplitBps,
  liveViewerTierFor,
  RECORDED_CREATOR_SPLIT_BPS,
  type LiveViewerTier,
} from "../pricing";
import { FlutterwaveClient } from "./flutterwave";

export interface CheckoutInput {
  type: "video_unlock" | "live_ticket";
  targetId: string;
  /** Payer MSISDN; defaults to the buyer's account phone. */
  phone?: string;
}

export interface CheckoutResult {
  transactionId: string;
  txRef: string;
  status: "pending";
  simulated: boolean;
}

/** Shape of the Flutterwave charge webhook payload we consume (§3.1). */
export interface WebhookPayload {
  event?: string;
  data?: {
    tx_ref?: string;
    status?: string;
    id?: number | string;
    amount?: number;
    currency?: string;
  };
}

/**
 * PaymentsService — the money path (§3). Checkout creates a PENDING ledger row
 * and fires the Flutterwave STK Push; settlement (via webhook) flips it to PAID,
 * grants the entitlement, and credits the creator's wallet with the snapshotted
 * split. All split math is computed once, at checkout, and stored on the
 * transaction so it never drifts if config changes later (§3.2).
 */
export class PaymentsService {
  constructor(
    private readonly users: UserRepository,
    private readonly creators: CreatorRepository,
    private readonly content: ContentRepository,
    private readonly live: LiveRepository,
    private readonly transactions: TransactionRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly financial: FinancialRepository,
    private readonly config: ConfigService,
    private readonly flw: FlutterwaveClient,
    private readonly audit: AuditRepository,
  ) {}

  async checkout(userId: string, input: CheckoutInput): Promise<CheckoutResult> {
    this.flw.assertReady();
    const buyer = await this.users.findById(userId);
    if (!buyer) throw notFound("user");
    if (buyer.status !== "active") throw forbidden("Account unavailable");
    const phone = normalizePhone(input.phone ?? buyer.phone);

    const resolved =
      input.type === "video_unlock"
        ? await this.resolveVideoTarget(input.targetId)
        : await this.resolveLiveTarget(input.targetId);

    if (resolved.creatorUserId === userId) {
      throw forbidden("you cannot purchase your own content");
    }

    // Already owns it? (either an active entitlement or a prior paid tx)
    const field = input.type === "video_unlock" ? "contentId" : "liveEventId";
    const owned = await this.entitlements.findActive(userId, field, input.targetId);
    if (owned) throw conflict("already_owned", "You already have access to this");
    const priorPaid = await this.transactions.findPaidForTarget(userId, field, input.targetId);
    if (priorPaid) throw conflict("already_paid", "You already paid for this");
    const pending = await this.transactions.findPendingForTarget(userId, field, input.targetId);
    if (pending) return this.checkoutResult(pending);

    const cfg = await this.config.pricingConfig();
    const split = computeSplit(resolved.grossUgx, resolved.creatorSplitBps, cfg);

    const txRef = `midpay_${crypto.randomUUID()}`;
    const row = {
      type: input.type,
      buyerId: userId,
      creatorId: resolved.creatorId,
      contentId: input.type === "video_unlock" ? input.targetId : null,
      liveEventId: input.type === "live_ticket" ? input.targetId : null,
      grossUgx: split.grossUgx,
      flutterwaveFeeUgx: split.flutterwaveFeeUgx,
      netPoolUgx: split.netPoolUgx,
      creatorShareUgx: split.creatorShareUgx,
      platformShareUgx: split.platformShareUgx,
      creatorSplitBps: split.creatorSplitBps,
      liveViewerTier: resolved.liveViewerTier ?? null,
      paymentStatus: "pending" as const,
      flutterwaveTxRef: txRef,
    };
    let tx: Transaction;
    try {
      tx = await this.transactions.create(row);
    } catch (err) {
      // The unique pending-target index arbitrates concurrent checkout calls.
      const winner = await this.transactions.findPendingForTarget(userId, field, input.targetId);
      if (winner) return this.checkoutResult(winner);
      if (await this.transactions.findPaidForTarget(userId, field, input.targetId)) {
        throw conflict("already_paid", "You already paid for this");
      }
      throw err;
    }

    const charge = await this.flw.initiateMobileMoneyCharge({
      txRef,
      amountUgx: split.grossUgx,
      phone,
      narration: input.type === "video_unlock" ? "MidPay video unlock" : "MidPay live ticket",
    });

    if (charge.status === "failed") {
      await this.transactions.markFailed(tx.id);
      throw new ApiError(502, "charge_failed", "Payment provider declined the charge");
    }

    return this.checkoutResult(tx);
  }

  private checkoutResult(tx: Transaction): CheckoutResult {
    return { transactionId: tx.id, txRef: tx.flutterwaveTxRef!, status: "pending", simulated: this.flw.isSimulated };
  }

  async pendingForFinance() {
    return (await this.transactions.listPending()).map((tx) => ({ id: tx.id, grossUgx: tx.grossUgx,
      type: tx.type, createdAt: tx.createdAt, updatedAt: tx.updatedAt, status: tx.paymentStatus }));
  }

  async verifyForFinance(adminId: string, id: string) {
    // Record intent before contacting the provider; crashes leave a visible attempt.
    const attemptId = crypto.randomUUID();
    await this.audit.record({ adminId, action: "payment.verify.requested", targetType: "transaction",
      targetId: id, detail: { attemptId } });
    try {
      const result = await this.verifyForFinanceResult(id);
      await this.audit.record({ adminId, action: "payment.verify.completed", targetType: "transaction",
        targetId: id, detail: { attemptId, ...result } });
      return result;
    } catch (error) {
      await this.audit.record({ adminId, action: "payment.verify.failed", targetType: "transaction",
        targetId: id, detail: { attemptId, reason: "verification_not_completed" } });
      throw error;
    }
  }

  private async verifyForFinanceResult(id: string) {
    const tx = await this.transactions.findById(id);
    if (!tx) throw notFound("transaction");
    if (tx.paymentStatus === "pending") {
      this.flw.assertReady();
      if (!this.flw.isConfigured || !tx.flutterwaveTxRef) {
        return { status: tx.paymentStatus, reason: "verification_unavailable" };
      }
      const payment = await this.flw.verifyPayment(tx.flutterwaveTxRef);
      if (payment) await this.applyProviderPayment(tx, payment);
    }
    return { status: (await this.transactions.findById(id))!.paymentStatus };
  }

  /** Recover missed notifications by verification only; never initiate another charge. */
  async reconcilePending(): Promise<void> {
    if (!this.flw.isConfigured) return;
    this.flw.assertReady();
    const rows = await this.transactions.awaitingReconciliation();
    await Promise.all(rows.map(async (candidate) => {
      const tx = await this.transactions.claimReconciliation(candidate.id);
      if (!tx?.flutterwaveTxRef) return;
      try {
        const payment = await this.flw.verifyPayment(tx.flutterwaveTxRef);
        if (payment) await this.applyProviderPayment(tx, payment);
      } catch {
        // No provider payload, phone or credential is logged. Unknown outcomes
        // stay pending and retain checkout's duplicate-charge protection.
        console.warn("payment awaiting reconciliation", tx.id);
      }
    }));
  }

  async status(userId: string, id: string): Promise<{ status: Transaction["paymentStatus"]; owned: boolean }> {
    let tx = await this.transactions.findById(id);
    if (!tx || tx.buyerId !== userId) throw notFound("transaction");
    if (tx.paymentStatus === "pending" && !this.flw.isSimulated && tx.flutterwaveTxRef) {
      const payment = await this.flw.verifyPayment(tx.flutterwaveTxRef);
      if (payment) {
        await this.applyProviderPayment(tx, payment);
        tx = (await this.transactions.findById(id))!;
      }
    }
    const field = tx.contentId ? "contentId" : "liveEventId";
    const owned = !!(await this.entitlements.findActive(userId, field, (tx.contentId ?? tx.liveEventId)!));
    return { status: tx.paymentStatus, owned };
  }

  private async resolveVideoTarget(contentId: string) {
    const item = await this.content.findById(contentId);
    if (!item || item.status === "deleted") throw notFound("content");
    if (item.status !== "published") throw badRequest("not_for_sale", "Content is not on sale");
    if (item.pricing !== "paid" || item.priceUgx == null) {
      throw badRequest("not_paid_content", "This content is free");
    }
    const creator = await this.creators.findById(item.creatorId);
    if (!creator) throw notFound("creator");
    if (creator.status !== "active") throw forbidden("Creator is unavailable");
    const owner = await this.users.findById(creator.userId);
    if (!owner || owner.status !== "active") throw forbidden("Creator is unavailable");
    const creatorSplitBps = creator.recordedSplitBpsOverride ?? RECORDED_CREATOR_SPLIT_BPS;
    return {
      creatorId: item.creatorId,
      creatorUserId: creator.userId,
      grossUgx: item.priceUgx,
      creatorSplitBps,
      liveViewerTier: undefined as LiveViewerTier | undefined,
    };
  }

  private async resolveLiveTarget(liveEventId: string) {
    const event = await this.live.findById(liveEventId);
    if (!event) throw notFound("live event");
    if (event.status !== "scheduled" && event.status !== "live") {
      throw badRequest("not_for_sale", `Live event is ${event.status}`);
    }
    if (event.status === "live") {
      if (!event.startedAt) throw badRequest("not_for_sale", "Live event has no valid start time");
      const deadline = event.startedAt.getTime() + (event.declaredDurationMin + await this.config.liveGraceMinutes()) * 60000;
      if (Date.now() >= deadline) throw badRequest("not_for_sale", "Live event has reached its time limit");
    }
    const creator = await this.creators.findById(event.creatorId);
    if (!creator) throw notFound("creator");
    if (creator.status !== "active") throw forbidden("Creator is unavailable");
    const owner = await this.users.findById(creator.userId);
    if (!owner || owner.status !== "active") throw forbidden("Creator is unavailable");
    // Split tier is chosen from current concurrent viewers (§3.2 matrix). We use
    // the running peak as the proxy at purchase time; a per-creator override wins.
    const tier = liveViewerTierFor(event.peakConcurrentViewers);
    const creatorSplitBps = event.creatorSplitBps ?? creator.liveSplitBpsOverride ?? liveCreatorSplitBps(tier);
    return {
      creatorId: event.creatorId,
      creatorUserId: creator.userId,
      grossUgx: event.ticketPriceUgx,
      creatorSplitBps,
      liveViewerTier: event.creatorSplitBps == null ? tier as LiveViewerTier : undefined,
    };
  }

  /**
   * Settle a charge from a Flutterwave webhook (§3.1). Idempotent: a duplicate
   * webhook for an already-paid transaction is a no-op. Verifies the signature,
   * marks the ledger row paid, grants the entitlement, and credits the wallet.
   */
  async settleFromWebhook(
    payload: WebhookPayload,
    verifHash: string | undefined,
  ): Promise<{ settled: boolean; reason?: string }> {
    if (!this.flw.verifyWebhook(verifHash)) {
      throw new ApiError(401, "bad_signature", "Invalid webhook signature");
    }

    const txRef = payload.data?.tx_ref;
    if (!txRef) throw badRequest("missing_tx_ref", "Webhook has no tx_ref");

    const tx = await this.transactions.findByTxRef(txRef);
    if (!tx) return { settled: false, reason: "unknown_tx_ref" }; // ignore unknown

    if (tx.paymentStatus === "paid") return { settled: true, reason: "already_settled" };
    if (tx.paymentStatus === "refunded") return { settled: false, reason: "already_refunded" };

    // The webhook is a notification; configured payments are verified directly
    // with the provider before any access or money is granted.
    const payment = this.flw.isSimulated ? payload.data : await this.flw.verifyPayment(txRef);
    if (!payment) return { settled: false, reason: "awaiting_verification" };
    return this.applyProviderPayment(tx, payment);
  }

  private async applyProviderPayment(tx: Transaction, payment: NonNullable<WebhookPayload["data"]>): Promise<{ settled: boolean; reason?: string }> {
    if (payment.tx_ref !== tx.flutterwaveTxRef) throw badRequest("reference_mismatch", "Payment reference does not match");
    const providerStatus = payment.status;
    if (providerStatus !== "successful") {
      if (providerStatus === "failed" || providerStatus === "cancelled") await this.transactions.markFailed(tx.id);
      return { settled: false, reason: `provider_status_${providerStatus ?? "unknown"}` };
    }

    // Guard against amount/currency tampering.
    const amount = payment.amount;
    const currency = payment.currency;
    if (amount == null || Number(amount) !== tx.grossUgx) {
      throw badRequest("amount_mismatch", "Webhook amount does not match the transaction");
    }
    if (currency !== "UGX") {
      throw badRequest("currency_mismatch", "Unexpected currency");
    }
    if (!this.flw.isSimulated && (payment.id == null || !/^\d+$/.test(String(payment.id)))) {
      throw badRequest("missing_provider_id", "Verified payment has no valid provider ID");
    }

    await this.financial.settle(tx.id, payment.id != null ? String(payment.id) : undefined);
    return { settled: true };
  }

}
