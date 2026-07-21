import type { Creator } from "../../db/schema";
import { AuditRepository } from "../../repositories/audit.repository";
import { CreatorRepository } from "../../repositories/creator.repository";
import { notFound } from "../errors";

/**
 * CreatorAdminService — admin actions on creator accounts (§7.3): suspend / ban
 * / reinstate for abuse response, and an optional verification badge (the
 * downgraded "KYC" — a badge / payout-account check, NOT a gate on signup or
 * posting). All audit-logged (§7.1).
 */
export class CreatorAdminService {
  constructor(
    private readonly creators: CreatorRepository,
    private readonly audit: AuditRepository,
  ) {}

  async get(id: string): Promise<Creator> {
    const creator = await this.creators.findById(id);
    if (!creator) throw notFound("creator");
    return creator;
  }

  private async setStatus(
    adminId: string,
    id: string,
    status: Creator["status"],
    action: string,
    patch: Partial<Creator> = {},
  ): Promise<Creator> {
    const updated = await this.creators.updateById(id, { status, ...patch });
    if (!updated) throw notFound("creator");
    await this.audit.record({ adminId, action, targetType: "creator", targetId: id, detail: patch });
    return updated;
  }

  suspend(adminId: string, id: string, reason?: string): Promise<Creator> {
    return this.setStatus(adminId, id, "suspended", "creator.suspend", { suspensionReason: reason });
  }

  ban(adminId: string, id: string, reason?: string): Promise<Creator> {
    return this.setStatus(adminId, id, "banned", "creator.ban", { suspensionReason: reason });
  }

  reinstate(adminId: string, id: string): Promise<Creator> {
    return this.setStatus(adminId, id, "active", "creator.reinstate", { suspensionReason: null });
  }

  /** Optional verification badge / payout-account check (downgraded KYC). */
  async verify(adminId: string, id: string): Promise<Creator> {
    const updated = await this.creators.updateById(id, {
      verified: true,
      standing: "verified",
      kycStatus: "approved",
      kycReviewedBy: adminId,
      kycReviewedAt: new Date(),
    });
    if (!updated) throw notFound("creator");
    await this.audit.record({ adminId, action: "creator.verify", targetType: "creator", targetId: id });
    return updated;
  }
}
