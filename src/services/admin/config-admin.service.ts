import type { Env } from "../../env";
import { AuditRepository } from "../../repositories/audit.repository";
import { ConfigRepository } from "../../repositories/config.repository";
import { badRequest, notFound } from "../errors";
import { CONFIG_KEYS, configKeyDef, validateConfigValue } from "../config-keys";

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
