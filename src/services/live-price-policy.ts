import { badRequest } from "./errors";

export const LIVE_PRICE_POLICY_KEY = "LIVE_COST_PRICE_POLICY";
export interface LivePricePolicy {
  usdToUgx: number;
  conversionPercent: number;
  participantUsdPerMinute: number;
  downstreamUsdPerGb: number;
  bitrateMbps: number;
  networkOverheadPercent: number;
  graceMinutes: number;
  collectionPercent: number;
  collectionFixedUgx: number;
  creatorPercent: number;
  overheadUgxPerTicket: number;
  reservePercent: number;
  profitUgxPerTicket: number;
  blockMinutes: number;
  roundingUgx: number;
}

export const POLICY_DEFAULTS: LivePricePolicy = {
  usdToUgx: 3800, conversionPercent: 3, participantUsdPerMinute: 0.0005,
  downstreamUsdPerGb: 0.12, bitrateMbps: 2, networkOverheadPercent: 15,
  graceMinutes: 5, collectionPercent: 3, collectionFixedUgx: 0, creatorPercent: 70,
  overheadUgxPerTicket: 200, reservePercent: 15, profitUgxPerTicket: 100,
  blockMinutes: 30, roundingUgx: 100,
};

export function validatePolicy(input: unknown): LivePricePolicy {
  if (!input || typeof input !== "object") throw badRequest("invalid_policy", "Cost assumptions are required");
  const p = {} as LivePricePolicy;
  for (const key of Object.keys(POLICY_DEFAULTS) as (keyof LivePricePolicy)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e9) {
      throw badRequest("invalid_policy", `${key} must be a finite non-negative number`);
    }
    p[key] = value;
  }
  if (p.usdToUgx <= 0 || p.bitrateMbps <= 0 || p.roundingUgx < 1 || !Number.isSafeInteger(p.roundingUgx)
    || ![15, 30, 60].includes(p.blockMinutes) || p.collectionPercent >= 100 || p.creatorPercent >= 100
    || p.creatorPercent < 70 || p.graceMinutes > 1440) {
    throw badRequest("invalid_policy", "Use 15/30/60 minute blocks, positive FX/bitrate/rounding, creator share 70–<100% and collection fee below 100%");
  }
  return p;
}

/** Gross ticket floor: collection fees first, then creator/platform split. */
export function quotePolicy(p: LivePricePolicy, durationMinutes: number, creatorPercent = p.creatorPercent) {
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 10080) {
    throw badRequest("bad_duration", "Duration must be 1–10080 whole minutes");
  }
  if (creatorPercent >= 100) throw badRequest("invalid_split", "Creator share leaves no platform revenue to cover costs");
  const billedMinutes = Math.ceil(durationMinutes / p.blockMinutes) * p.blockMinutes + p.graceMinutes;
  const dataGb = p.bitrateMbps * billedMinutes * 60 / 8000 * (1 + p.networkOverheadPercent / 100);
  const transportUsd = billedMinutes * p.participantUsdPerMinute + dataGb * p.downstreamUsdPerGb;
  const transportUgx = transportUsd * p.usdToUgx * (1 + p.conversionPercent / 100);
  const budgetUgx = (transportUgx + p.overheadUgxPerTicket) * (1 + p.reservePercent / 100) + p.profitUgxPerTicket;
  const platformFraction = 1 - Math.max(p.creatorPercent, creatorPercent) / 100;
  const rawFloor = (budgetUgx / platformFraction + p.collectionFixedUgx) / (1 - p.collectionPercent / 100);
  const floor = Math.ceil(rawFloor / p.roundingUgx) * p.roundingUgx;
  if (!Number.isSafeInteger(floor) || floor > 1e9) throw badRequest("invalid_policy", "Calculated floor exceeds supported ticket amount");
  return { floor, billedMinutes, dataGb, transportUsd, transportUgx, budgetUgx };
}
