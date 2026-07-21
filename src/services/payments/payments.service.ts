import type { Transaction } from "../../db/schema";
import { ContentRepository } from "../../repositories/content.repository";
import { CreatorRepository } from "../../repositories/creator.repository";
import { EntitlementRepository } from "../../repositories/entitlement.repository";
import { LiveRepository } from "../../repositories/live.repository";
import { TransactionRepository } from "../../repositories/transaction.repository";
import { UserRepository } from "../../repositories/user.repository";
import { WalletRepository } from "../../repositories/wallet.repository";
import { ConfigService } from "../config.service";
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
    private readonly wallets: WalletRepository,
    private readonly config: ConfigService,
    private readonly flw: FlutterwaveClient,
  ) {}

  async checkout(userId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const buyer = await this.users.findById(userId);
    if (!buyer) throw notFound("user");
    const phone = input.phone ?? buyer.phone;

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

    const cfg = await this.config.pricingConfig();
    const split = computeSplit(resolved.grossUgx, resolved.creatorSplitBps, cfg);

    const txRef = `midpay_${crypto.randomUUID()}`;
    const tx = await this.transactions.create({
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
      paymentStatus: "pending",
      flutterwaveTxRef: txRef,
    });

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

    return {
      transactionId: tx.id,
      txRef,
      status: "pending",
      simulated: charge.simulated,
    };
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
    const creator = await this.creators.findById(event.creatorId);
    if (!creator) throw notFound("creator");
    // Split tier is chosen from current concurrent viewers (§3.2 matrix). We use
    // the running peak as the proxy at purchase time; a per-creator override wins.
    const tier = liveViewerTierFor(event.peakConcurrentViewers);
    const creatorSplitBps = creator.liveSplitBpsOverride ?? liveCreatorSplitBps(tier);
    return {
      creatorId: event.creatorId,
      creatorUserId: creator.userId,
      grossUgx: event.ticketPriceUgx,
      creatorSplitBps,
      liveViewerTier: tier as LiveViewerTier | undefined,
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

    const providerStatus = payload.data?.status;
    if (providerStatus !== "successful") {
      await this.transactions.markFailed(tx.id);
      return { settled: false, reason: `provider_status_${providerStatus ?? "unknown"}` };
    }

    // Guard against amount/currency tampering.
    const amount = payload.data?.amount;
    const currency = payload.data?.currency;
    if (amount != null && Number(amount) !== tx.grossUgx) {
      throw badRequest("amount_mismatch", "Webhook amount does not match the transaction");
    }
    if (currency != null && currency !== "UGX") {
      throw badRequest("currency_mismatch", "Unexpected currency");
    }

    await this.settle(tx, payload.data?.id != null ? String(payload.data.id) : undefined);
    return { settled: true };
  }

  private async settle(tx: Transaction, providerId?: string): Promise<void> {
    await this.transactions.markPaid(tx.id, {
      flutterwaveFlwId: providerId,
      paidAt: new Date(),
    });

    await this.entitlements.create({
      userId: tx.buyerId,
      transactionId: tx.id,
      contentId: tx.contentId,
      liveEventId: tx.liveEventId,
    });

    await this.wallets.creditSale({
      creatorId: tx.creatorId,
      amountUgx: tx.creatorShareUgx,
      transactionId: tx.id,
    });

    if (tx.type === "video_unlock" && tx.contentId) {
      await this.content.incrementPurchaseCount(tx.contentId);
    } else if (tx.type === "live_ticket" && tx.liveEventId) {
      await this.live.incrementTicketsSold(tx.liveEventId);
    }
  }
}
