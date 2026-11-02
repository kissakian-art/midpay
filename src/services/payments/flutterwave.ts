import type { Env } from "../../env";
import { timingSafeEqual } from "../crypto";
import { ApiError } from "../errors";

/**
 * Flutterwave client (§3.1). Wraps the mobile-money "STK Push" charge and
 * webhook verification. If FLW_SECRET_KEY is not configured (dev), it runs in
 * SIMULATED mode: no network call, returns a pending charge so the rest of the
 * flow can be exercised. Wire real keys via `wrangler secret put` for launch.
 */
const FLW_BASE = "https://api.flutterwave.com/v3";

export interface ChargeRequest {
  txRef: string;
  amountUgx: number;
  phone: string;
  email?: string;
  narration?: string;
}

export interface ChargeResult {
  status: "pending" | "failed";
  providerId?: string;
  simulated: boolean;
  raw?: unknown;
}

export interface ProviderPayment {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
}

export interface TransferResult {
  status: "pending" | "success" | "failed";
  transferId?: string;
  simulated: boolean;
}

export class FlutterwaveClient {
  constructor(private readonly env: Env) {}

  get isConfigured(): boolean {
    return !!this.env.FLW_SECRET_KEY;
  }

  get isSimulated(): boolean {
    return this.env.ENVIRONMENT === "development" && !this.isConfigured;
  }

  assertReady(): void {
    if (!this.isSimulated && (!this.isConfigured || !this.env.FLW_WEBHOOK_HASH)) {
      throw new ApiError(503, "payments_unconfigured", "Payments are not configured");
    }
  }

  async availablePayoutBalanceUgx(): Promise<number> {
    this.assertReady();
    if (this.isSimulated) return Number.MAX_SAFE_INTEGER;
    const { response, body } = await this.fetchProvider('/balances');
    const row = Array.isArray(body?.data) ? body.data.find((v) => v.currency === 'UGX') : undefined;
    if (!response.ok || body?.status !== 'success' || !Number.isFinite(row?.available_balance) || row.available_balance < 0) {
      throw new ApiError(503, 'payout_balance_unavailable', 'Withdrawals are temporarily unavailable. Please retry later.');
    }
    return Math.floor(row.available_balance);
  }

  private async fetchProvider(path: string, init?: RequestInit): Promise<{ response: Response; body: { status?: string; data?: unknown } | null }> {
    const response = await fetch(`${FLW_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.env.FLW_SECRET_KEY}`, "content-type": "application/json" },
    });
    const body = await response.json().catch(() => null) as { status?: string; data?: unknown } | null;
    return { response, body };
  }

  async verifyPayment(txRef: string): Promise<ProviderPayment | null> {
    this.assertReady();
    if (this.isSimulated) return null;
    const { response, body } = await this.fetchProvider(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
    // A lookup miss is not proof of failure; an STK charge may still be pending.
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok || body?.status !== "success" || !body.data) {
      throw new ApiError(502, "verification_unavailable", "Payment verification is unavailable; try again");
    }
    return body.data as ProviderPayment;
  }

  /** Initiate a Uganda mobile-money charge (fires the STK Push, §3.1). */
  async initiateMobileMoneyCharge(req: ChargeRequest): Promise<ChargeResult> {
    this.assertReady();
    if (this.isSimulated) {
      // Simulated: pretend the push was sent; settlement arrives via a
      // (manually-triggered in dev) webhook call.
      return { status: "pending", simulated: true };
    }

    const res = await fetch(`${FLW_BASE}/charges?type=mobile_money_uganda`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${this.env.FLW_SECRET_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: req.txRef,
        amount: req.amountUgx,
        currency: "UGX",
        phone_number: req.phone,
        email: req.email ?? `${req.phone.replace(/[^0-9]/g, "")}@midpay.local`,
        ...(req.narration ? { narration: req.narration } : {}),
      }),
    });

    const raw = (await res.json().catch(() => null)) as
      | { status?: string }
      | null;
    if (res.status >= 500 || !raw) {
      throw new ApiError(502, "payment_outcome_unknown", "Payment is awaiting confirmation; check its status before trying again");
    }
    if (!res.ok || raw?.status !== "success") {
      return { status: "failed", simulated: false, raw };
    }
    return { status: "pending", simulated: false, raw };
  }

  /**
   * Initiate an outbound mobile-money transfer (creator payout, §7.5). Uses the
   * Flutterwave Transfers API. Simulated (no network) when unconfigured.
   */
  async initiateTransfer(req: {
    reference: string;
    amountUgx: number;
    msisdn: string;
    provider?: string; // 'mtn' | 'airtel'
    narration?: string;
  }): Promise<TransferResult> {
    this.assertReady();
    if (this.isSimulated) {
      return { status: "success", transferId: `sim_${req.reference}`, simulated: true };
    }
    const res = await fetch(`${FLW_BASE}/transfers`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${this.env.FLW_SECRET_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_bank: req.provider === "airtel" ? "AIRTEL" : "MPS", // provider rail
        account_number: req.msisdn,
        amount: req.amountUgx,
        currency: "UGX",
        reference: req.reference,
        narration: req.narration ?? "MidPay creator payout",
      }),
    });
    const raw = (await res.json().catch(() => null)) as { status?: string; data?: { id?: number } } | null;
    // An HTTP error/timeout is ambiguous. Never release funds without a lookup.
    return { status: "pending", transferId: raw?.data?.id != null ? String(raw.data.id) : undefined, simulated: false };
  }

  async verifyTransfer(req: { reference: string; transferId?: string | null; amountUgx: number; msisdn: string }): Promise<TransferResult> {
    this.assertReady();
    if (this.isSimulated) return { status: "success", transferId: `sim_${req.reference}`, simulated: true };
    const path = req.transferId ? `/transfers/${encodeURIComponent(req.transferId)}` : `/transfers?reference=${encodeURIComponent(req.reference)}`;
    const { response, body } = await this.fetchProvider(path);
    if (!response.ok || body?.status !== "success") return { status: "pending", simulated: false };
    const rows = Array.isArray(body.data) ? body.data : [body.data];
    const row = rows.find((r) => r && typeof r === "object" && (r as { reference?: string }).reference === req.reference) as
      { id?: number; reference: string; status?: string; amount?: number; currency?: string; account_number?: string } | undefined;
    if (!row || Number(row.amount) !== req.amountUgx || row.currency !== "UGX" || row.account_number !== req.msisdn) {
      return { status: "pending", simulated: false };
    }
    return { status: row.status === "SUCCESSFUL" ? "success" : row.status === "FAILED" ? "failed" : "pending", transferId: row.id != null ? String(row.id) : undefined, simulated: false };
  }

  /**
   * Verify an inbound webhook's `verif-hash` header against the configured
   * secret hash (§3.1). If no hash is configured (dev), verification is skipped
   * so you can hand-post webhooks locally.
   */
  verifyWebhook(verifHashHeader: string | undefined): boolean {
    const expected = this.env.FLW_WEBHOOK_HASH;
    if (!expected) return this.isSimulated;
    if (!verifHashHeader) return false;
    return timingSafeEqual(expected, verifHashHeader);
  }
}
