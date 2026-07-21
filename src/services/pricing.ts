/**
 * pricing.ts — the platform's money rules as pure functions (§3.2, §3.3).
 * No DB, no I/O: deterministic and unit-testable. The repository/service layer
 * calls these; the config constants are passed in (sourced from platform_config
 * / env, §7.2) rather than hardcoded, so the owner can tune them.
 */

export interface PricingConfig {
  /** §3.3 — minimum live ticket price per declared hour (UGX). Default 5000. */
  liveMinPricePerHour: number;
  /** §3.2 — recorded content price floor (UGX). Default 5000. */
  recordedPriceFloor: number;
  /** §3.1 — Flutterwave collection fee, percent. Default 3. */
  flutterwaveFeePercent: number;
}

/** §3.2 revenue-split matrix. Creator share in basis points (7000 = 70%). */
export const RECORDED_CREATOR_SPLIT_BPS = 7000; // 70/30, any volume

export type LiveViewerTier = "tier_1_200" | "tier_201_500" | "tier_501_plus";

export function liveViewerTierFor(concurrentViewers: number): LiveViewerTier {
  if (concurrentViewers <= 200) return "tier_1_200";
  if (concurrentViewers <= 500) return "tier_201_500";
  return "tier_501_plus";
}

export function liveCreatorSplitBps(tier: LiveViewerTier): number {
  switch (tier) {
    case "tier_1_200":
      return 6000; // 60/40
    case "tier_201_500":
      return 6500; // 65/35
    case "tier_501_plus":
      return 7000; // 70/30
  }
}

/**
 * §3.3 Live Duration-Based Price Floor.
 *   minLivePrice = LIVE_MIN_PRICE_PER_HOUR × ceil(declaredDurationMin / 60)
 * e.g. up to 60min → 5,000; 61–120 → 10,000; 121–180 → 15,000.
 */
export function minLivePrice(
  declaredDurationMin: number,
  cfg: Pick<PricingConfig, "liveMinPricePerHour">,
): number {
  if (declaredDurationMin <= 0) {
    throw new RangeError("declaredDurationMin must be positive");
  }
  const hours = Math.ceil(declaredDurationMin / 60);
  return cfg.liveMinPricePerHour * hours;
}

export interface FloorCheck {
  ok: boolean;
  floor: number;
}

/** Validate a creator-set live ticket price against the §3.3 floor. */
export function validateLivePrice(
  ticketPriceUgx: number,
  declaredDurationMin: number,
  cfg: Pick<PricingConfig, "liveMinPricePerHour">,
): FloorCheck {
  const floor = minLivePrice(declaredDurationMin, cfg);
  return { ok: ticketPriceUgx >= floor, floor };
}

/** Validate a recorded-content price against the §3.2 floor. */
export function validateRecordedPrice(
  priceUgx: number,
  cfg: Pick<PricingConfig, "recordedPriceFloor">,
): FloorCheck {
  return { ok: priceUgx >= cfg.recordedPriceFloor, floor: cfg.recordedPriceFloor };
}

export interface SplitResult {
  grossUgx: number;
  flutterwaveFeeUgx: number;
  netPoolUgx: number;
  creatorShareUgx: number;
  platformShareUgx: number;
  creatorSplitBps: number;
}

/**
 * Apply the split to a gross ticket price (§3.2 simulation). Fee is taken from
 * the gross first, then the creator/platform split applies to the net pool.
 * Integer UGX throughout; rounding favors the platform's fee and floors the
 * creator share so the two shares always reconcile to the net pool exactly.
 */
export function computeSplit(
  grossUgx: number,
  creatorSplitBps: number,
  cfg: Pick<PricingConfig, "flutterwaveFeePercent">,
): SplitResult {
  const flutterwaveFeeUgx = Math.round((grossUgx * cfg.flutterwaveFeePercent) / 100);
  const netPoolUgx = grossUgx - flutterwaveFeeUgx;
  const creatorShareUgx = Math.floor((netPoolUgx * creatorSplitBps) / 10000);
  const platformShareUgx = netPoolUgx - creatorShareUgx;
  return {
    grossUgx,
    flutterwaveFeeUgx,
    netPoolUgx,
    creatorShareUgx,
    platformShareUgx,
    creatorSplitBps,
  };
}
