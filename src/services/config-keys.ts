import type { Env } from "../env";

/**
 * The registry of owner-tunable config keys (§7.2). Each maps to a
 * wrangler.toml [vars] default (the fallback) and a validation kind. The admin
 * config editor renders and validates against this list; ConfigService reads
 * the effective value (latest platform_config row, else the env default).
 */
export type ConfigKind = "int" | "percent";

export interface ConfigKeyDef {
  key: string;
  envVar: keyof Env;
  kind: ConfigKind;
  label: string;
}

export const CONFIG_KEYS: ConfigKeyDef[] = [
  { key: "LIVE_MIN_PRICE_PER_HOUR", envVar: "LIVE_MIN_PRICE_PER_HOUR", kind: "int", label: "Live min price per hour (UGX)" },
  { key: "STREAMING_COST_PER_VIEWER_MINUTE", envVar: "STREAMING_COST_PER_VIEWER_MINUTE", kind: "int", label: "Streaming cost per viewer-minute (UGX)" },
  { key: "RECORDED_PRICE_FLOOR", envVar: "RECORDED_PRICE_FLOOR", kind: "int", label: "Recorded price floor (UGX)" },
  { key: "CLIP_MAX_LENGTH_SECONDS", envVar: "CLIP_MAX_LENGTH_SECONDS", kind: "int", label: "Clip max length (seconds)" },
  { key: "LIVE_AUTO_TERMINATE_GRACE_MINUTES", envVar: "LIVE_AUTO_TERMINATE_GRACE_MINUTES", kind: "int", label: "Live auto-terminate grace (minutes)" },
  { key: "FLUTTERWAVE_FEE_PERCENT", envVar: "FLUTTERWAVE_FEE_PERCENT", kind: "percent", label: "Flutterwave fee (%)" },
  { key: "MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT", envVar: "MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT", kind: "percent", label: "Withdrawal duty (%)" },
  { key: "MIN_PAYOUT_THRESHOLD_UGX", envVar: "MIN_PAYOUT_THRESHOLD_UGX", kind: "int", label: "Min payout threshold (UGX)" },
  { key: "MONTHLY_OPEX_TARGET_UGX", envVar: "MONTHLY_OPEX_TARGET_UGX", kind: "int", label: "Monthly opex target (UGX)" },
  { key: "PHONE_VERIFICATION_ENABLED", envVar: "PHONE_VERIFICATION_ENABLED", kind: "int", label: "Phone OTP verification (1=on, 0=bypass — dev only)" },
];

const BY_KEY = new Map(CONFIG_KEYS.map((k) => [k.key, k]));

export function configKeyDef(key: string): ConfigKeyDef | undefined {
  return BY_KEY.get(key);
}

/** Validate a numeric value against a key's kind. Returns the coerced number. */
export function validateConfigValue(def: ConfigKeyDef, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${def.key} must be a non-negative number`);
  }
  if (def.kind === "int" && !Number.isInteger(value)) {
    throw new Error(`${def.key} must be an integer`);
  }
  if (def.kind === "percent" && value >= 100) {
    throw new Error(`${def.key} must be a percent below 100`);
  }
  return value;
}
