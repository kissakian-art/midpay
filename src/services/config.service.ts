import { and, desc, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { platformConfig } from "../db/schema";
import type { Env } from "../env";
import type { PricingConfig } from "./pricing";

/**
 * ConfigService — resolves effective business-rule values (§7.2). Precedence:
 *   1. latest `platform_config` row for the key with effectiveFrom ≤ now
 *   2. the wrangler.toml [vars] default (Env)
 * so the owner can tune rules from the admin console without a redeploy, while
 * the env vars remain a safe fallback.
 */
export class ConfigService {
  constructor(
    private readonly db: Database,
    private readonly env: Env,
  ) {}

  private async getRaw(key: string): Promise<string | undefined> {
    const row = await this.db
      .select()
      .from(platformConfig)
      .where(and(eq(platformConfig.key, key), lte(platformConfig.effectiveFrom, new Date())))
      .orderBy(desc(platformConfig.effectiveFrom))
      .get();
    return row?.valueJson;
  }

  private async getNumber(key: string, fallback: string): Promise<number> {
    const raw = (await this.getRaw(key)) ?? fallback;
    // Values are JSON-encoded in the table; plain numeric strings also parse.
    const n = Number(JSON.parse(raw));
    if (!Number.isFinite(n)) throw new Error(`config ${key} is not numeric`);
    return n;
  }

  async pricingConfig(): Promise<PricingConfig> {
    const [liveMinPricePerHour, recordedPriceFloor, flutterwaveFeePercent] =
      await Promise.all([
        this.getNumber("LIVE_MIN_PRICE_PER_HOUR", this.env.LIVE_MIN_PRICE_PER_HOUR),
        this.getNumber("RECORDED_PRICE_FLOOR", this.env.RECORDED_PRICE_FLOOR),
        this.getNumber("FLUTTERWAVE_FEE_PERCENT", this.env.FLUTTERWAVE_FEE_PERCENT),
      ]);
    return { liveMinPricePerHour, recordedPriceFloor, flutterwaveFeePercent };
  }

  clipMaxLengthSeconds(): Promise<number> {
    return this.getNumber("CLIP_MAX_LENGTH_SECONDS", this.env.CLIP_MAX_LENGTH_SECONDS);
  }

  /** Default minimum payout threshold, UGX (§7.5). Overridable per batch. */
  minPayoutThresholdUgx(): Promise<number> {
    return this.getNumber("MIN_PAYOUT_THRESHOLD_UGX", this.env.MIN_PAYOUT_THRESHOLD_UGX);
  }

  /** Mobile-money withdrawal excise duty, percent (§6.5). Default 0.5. */
  withdrawalDutyPercent(): Promise<number> {
    return this.getNumber(
      "MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT",
      this.env.MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT,
    );
  }

  /** Monthly opex break-even target, UGX (§6.3/§7.7). */
  monthlyOpexTargetUgx(): Promise<number> {
    return this.getNumber("MONTHLY_OPEX_TARGET_UGX", this.env.MONTHLY_OPEX_TARGET_UGX);
  }

  /** Is phone-OTP verification required at login? (0 = dev bypass.) */
  async phoneVerificationEnabled(): Promise<boolean> {
    return (
      (await this.getNumber("PHONE_VERIFICATION_ENABLED", this.env.PHONE_VERIFICATION_ENABLED)) !== 0
    );
  }
}
