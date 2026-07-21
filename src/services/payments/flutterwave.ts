import type { Env } from "../../env";
import { timingSafeEqual } from "../crypto";

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

export class FlutterwaveClient {
  constructor(private readonly env: Env) {}

  get isConfigured(): boolean {
    return !!this.env.FLW_SECRET_KEY;
  }

  /** Initiate a Uganda mobile-money charge (fires the STK Push, §3.1). */
  async initiateMobileMoneyCharge(req: ChargeRequest): Promise<ChargeResult> {
    if (!this.isConfigured) {
      // Simulated: pretend the push was sent; settlement arrives via a
      // (manually-triggered in dev) webhook call.
      return { status: "pending", simulated: true };
    }

    const res = await fetch(`${FLW_BASE}/charges?type=mobile_money_uganda`, {
      method: "POST",
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
    if (!res.ok || raw?.status === "error") {
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
  }): Promise<{ status: "success" | "failed"; transferId?: string; simulated: boolean; raw?: unknown }> {
    if (!this.isConfigured) {
      return { status: "success", transferId: `sim_${req.reference}`, simulated: true };
    }
    const res = await fetch(`${FLW_BASE}/transfers`, {
      method: "POST",
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
    if (!res.ok || raw?.status === "error") {
      return { status: "failed", simulated: false, raw };
    }
    return {
      status: "success",
      transferId: raw?.data?.id != null ? String(raw.data.id) : undefined,
      simulated: false,
      raw,
    };
  }

  /**
   * Verify an inbound webhook's `verif-hash` header against the configured
   * secret hash (§3.1). If no hash is configured (dev), verification is skipped
   * so you can hand-post webhooks locally.
   */
  verifyWebhook(verifHashHeader: string | undefined): boolean {
    const expected = this.env.FLW_WEBHOOK_HASH;
    if (!expected) return true; // dev: no hash configured
    if (!verifHashHeader) return false;
    return timingSafeEqual(expected, verifHashHeader);
  }
}
