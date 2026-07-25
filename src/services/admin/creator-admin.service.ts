import type { Creator, User } from "../../db/schema";
import { AuditRepository } from "../../repositories/audit.repository";
import { CreatorRepository } from "../../repositories/creator.repository";
import { UserRepository } from "../../repositories/user.repository";
import { normalizePhone, publicUser } from "../auth.service";
import { badRequest, notFound } from "../errors";

/** A phone-ish query: optional +, then digits (spaces/dashes allowed). */
function looksLikePhone(q: string): boolean {
  return /^\+?[\d\s-]{7,}$/.test(q);
}

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
    private readonly users: UserRepository,
  ) {}

  async get(id: string): Promise<Creator> {
    const creator = await this.creators.findById(id);
    if (!creator) throw notFound("creator");
    return creator;
  }

  /**
   * Resolve a `@handle` or phone number to its user + creator profile (§7.3).
   * Creators are 1:1 with users, so we find the user first. `creator` is null
   * when the account exists but hasn't tapped "Become a creator". The user view
   * has its password hash stripped.
   */
  async lookup(
    queryRaw: string,
  ): Promise<{ user: Omit<User, "passwordHash">; creator: Creator | null }> {
    const q = queryRaw.trim();
    if (!q) throw badRequest("empty_query", "Enter a @handle or phone number");

    let user: User | undefined;
    if (q.startsWith("@")) {
      user = await this.users.findByHandle(q.slice(1));
    } else if (looksLikePhone(q)) {
      user = await this.users.findByPhone(normalizePhone(q));
    } else {
      // Bare token: try it as a handle, then fall back to phone if it's numeric.
      user = await this.users.findByHandle(q);
      if (!user && looksLikePhone(q)) user = await this.users.findByPhone(normalizePhone(q));
    }
    if (!user) throw notFound("user");

    const creator = (await this.creators.findByUserId(user.id)) ?? null;
    return { user: publicUser(user), creator };
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
