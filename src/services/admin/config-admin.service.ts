import type { Env } from "../../env";
import { AuditRepository } from "../../repositories/audit.repository";
import { ConfigRepository } from "../../repositories/config.repository";
import { badRequest, notFound } from "../errors";
import { CONFIG_KEYS, configKeyDef, validateConfigValue } from "../config-keys";
import { LIVE_PRICE_POLICY_KEY, POLICY_DEFAULTS, quotePolicy, validatePolicy } from "../live-price-policy";
import { ExchangeRateService } from "../exchange-rate.service";

export interface EffectiveConfig {
  key: string;
  label: string;
  kind: string;
  value: number;
  source: "db" | "default";
  effectiveFrom: string | null;
}

/**
 * ConfigAdminService — the admin config editor (§7.2). Reads the effective
 * value of every tunable (db override → env default) and appends versioned
 * changes, each written to the audit log (§7.1). Only whitelisted keys from
 * config-keys.ts are editable.
 */
export class ConfigAdminService {
  constructor(
    private readonly config: ConfigRepository,
    private readonly audit: AuditRepository,
    private readonly env: Env,
  ) {}

  async livePricing() {
    const current = await this.config.currentlyEffective(LIVE_PRICE_POLICY_KEY, new Date());
    return { active: current ? JSON.parse(current.valueJson) : null, defaults: POLICY_DEFAULTS,
      exchangeRate: await new ExchangeRateService(this.config).current(),
      history: await this.config.history(LIVE_PRICE_POLICY_KEY) };
  }

  previewLivePricing(input: unknown, duration: number) {
    const policy = validatePolicy(input);
    return { policy, ...quotePolicy(policy, duration) };
  }

  async approveLivePricing(adminId: string, input: unknown, effectiveFromSec: number, automaticFx = false) {
    const policy = validatePolicy(input);
    quotePolicy(policy, 10080);
    if (!Number.isSafeInteger(effectiveFromSec) || effectiveFromSec < Math.floor(Date.now() / 1000) || effectiveFromSec > Math.floor(Date.now() / 1000) + 366 * 86400) {
      throw badRequest("invalid_effective_date", "Choose an effective time from now to one year ahead");
    }
    const fx = await new ExchangeRateService(this.config).approvalSnapshot(policy.usdToUgx, automaticFx);
    await this.config.appendAuditedPolicy(adminId, JSON.stringify({ ...policy, fx }), new Date(effectiveFromSec * 1000));
    return { policy, effectiveFrom: new Date(effectiveFromSec * 1000).toISOString() };
  }

  private envNumber(envVar: keyof Env): number {
    return Number(JSON.parse(String(this.env[envVar] ?? "0")));
  }

  /** Effective values for every tunable, with source + effective date. */
  async listEffective(): Promise<EffectiveConfig[]> {
    const now = new Date();
    const out: EffectiveConfig[] = [];
    for (const def of CONFIG_KEYS) {
      const row = await this.config.currentlyEffective(def.key, now);
      out.push({
        key: def.key,
        label: def.label,
        kind: def.kind,
        value: row ? Number(JSON.parse(row.valueJson)) : this.envNumber(def.envVar),
        source: row ? "db" : "default",
        effectiveFrom: row ? row.effectiveFrom.toISOString() : null,
      });
    }
    return out;
  }

  history(key: string) {
    if (!configKeyDef(key)) throw notFound("config key");
    return this.config.history(key);
  }

  /** Append a new effective-dated value for a key. */
  async setValue(
    adminId: string,
    key: string,
    value: unknown,
    effectiveFromSec?: number,
  ): Promise<EffectiveConfig> {
    const def = configKeyDef(key);
    if (!def) throw notFound("config key");

    let coerced: number;
    try {
      coerced = validateConfigValue(def, value);
    } catch (err) {
      throw badRequest("invalid_value", (err as Error).message);
    }

    const effectiveFrom = effectiveFromSec ? new Date(effectiveFromSec * 1000) : new Date();
    await this.config.append({
      key,
      valueJson: JSON.stringify(coerced),
      effectiveFrom,
      createdByAdminId: adminId,
    });
    await this.audit.record({
      adminId,
      action: "config.update",
      targetType: "platform_config",
      targetId: key,
      detail: { value: coerced, effectiveFrom: effectiveFrom.toISOString() },
    });

    return {
      key,
      label: def.label,
      kind: def.kind,
      value: coerced,
      source: "db",
      effectiveFrom: effectiveFrom.toISOString(),
    };
  }
}
