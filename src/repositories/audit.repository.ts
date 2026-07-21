import type { Database } from "../db/client";
import { auditLog } from "../db/schema";

/**
 * AuditRepository — append-only writer for the immutable admin audit trail
 * (§7.1/§7.9). No update/delete methods by design.
 */
export class AuditRepository {
  constructor(private readonly db: Database) {}

  record(entry: {
    adminId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string | null;
    detail?: unknown;
    ipAddress?: string;
  }): Promise<unknown> {
    return this.db
      .insert(auditLog)
      .values({
        adminId: entry.adminId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        detailJson: entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
        ipAddress: entry.ipAddress,
      })
      .run();
  }
}
