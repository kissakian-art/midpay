import { ConfigRepository } from "../repositories/config.repository";
import { badRequest } from "./errors";

const KEY = "USD_UGX_REFERENCE_RATE";
export const FX_SOURCE = "https://www.exchangerate-api.com";
export interface ExchangeRate { rate: number; asOf: number; fetchedAt: number; source: string }

export class ExchangeRateService {
  constructor(private readonly config: ConfigRepository) {}

  async current() {
    const row = await this.config.currentlyEffective(KEY, new Date());
    const rate: ExchangeRate | null = row ? JSON.parse(row.valueJson) : null;
    return { ...rate, available: !!rate, stale: !rate || Date.now() / 1000 - rate.asOf > 72 * 3600 };
  }

  async refresh(): Promise<void> {
    const cached = await this.current();
    if (cached.fetchedAt && Date.now() / 1000 - cached.fetchedAt < 23 * 3600) return;
    try {
      const response = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("fx_unavailable");
      const data = await response.json() as { result?: string; base_code?: string; rates?: { UGX?: number }; time_last_update_unix?: number };
      const rate = data.rates?.UGX, asOf = data.time_last_update_unix, now = Math.floor(Date.now() / 1000);
      if (data.result !== "success" || data.base_code !== "USD" || typeof rate !== "number" || !Number.isFinite(rate)
        || rate <= 0 || rate > 1000000 || typeof asOf !== "number" || !Number.isSafeInteger(asOf)
        || asOf > now + 300 || now - asOf > 72 * 3600 || (cached.asOf && asOf < cached.asOf)) throw new Error("fx_invalid");
      await this.config.append({ key: KEY, valueJson: JSON.stringify({ rate, asOf, fetchedAt: now, source: FX_SOURCE }),
        effectiveFrom: new Date(), createdByAdminId: null });
    } catch {
      console.warn("exchange rate refresh failed; retaining last successful rate");
    }
  }

  async approvalSnapshot(rate: number, automatic: boolean) {
    if (!automatic) return { mode: "manual" };
    const current = await this.current();
    if (!current.available || current.stale) throw badRequest("fx_stale", "Automatic rate is unavailable or over 72 hours old. Wait for refresh or explicitly select manual override.");
    if (current.rate !== rate) throw badRequest("fx_changed", "Exchange rate changed. Reload the calculator and review the new minimum before approval.");
    return { mode: "automatic", source: current.source, rate: current.rate, asOf: current.asOf, fetchedAt: current.fetchedAt };
  }
}
