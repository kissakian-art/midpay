import { sign } from "hono/jwt";
import type { AdminUser } from "../../db/schema";
import type { Env } from "../../env";
import { AdminRepository } from "../../repositories/admin.repository";
import { AuditRepository } from "../../repositories/audit.repository";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import { hashPassword, verifyPassword } from "../crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../totp";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h admin session

/** Public shape of an admin (never leak the password hash). */
export type AdminView = Omit<AdminUser, "passwordHash" | "totpSecret">;

function view(a: AdminUser): AdminView {
  const { passwordHash: _p, totpSecret: _t, ...rest } = a;
  return rest;
}

/**
 * AdminAuthService — RBAC login for the admin console (§7.1). Passwords are
 * PBKDF2-hashed. NOTE: §7.1 mandates 2FA for every admin; the TOTP columns exist
 * but enforcement is a follow-up — flagged as a launch TODO.
 */
export class AdminAuthService {
  constructor(
    private readonly admins: AdminRepository,
    private readonly audit: AuditRepository,
    private readonly env: Env,
  ) {}

  /** First-run only: create the initial Super Admin when none exist. */
  async bootstrap(email: string, password: string, displayName?: string): Promise<AdminView> {
    if ((await this.admins.count()) > 0) {
      throw conflict("already_bootstrapped", "An admin already exists; ask a Super Admin to add you");
    }
    if (password.length < 10) {
      throw new ApiError(400, "weak_password", "Password must be at least 10 characters");
    }
    const admin = await this.admins.create({
      email,
      displayName,
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    await this.audit.record({ adminId: admin.id, action: "admin.bootstrap", targetType: "admin_user", targetId: admin.id });
    return view(admin);
  }

  async login(
    email: string,
    password: string,
    totpCode?: string,
  ): Promise<{ token: string; admin: AdminView }> {
    const admin = await this.admins.findByEmail(email);
    // Constant-ish failure regardless of whether the email exists.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : false;
    if (!admin || !ok) throw new ApiError(401, "invalid_credentials", "Wrong email or password");
    if (admin.status !== "active") throw forbidden("admin account is disabled");

    // 2FA gate (§7.1): once enabled, every login needs a valid TOTP code.
    if (admin.totpEnabled) {
      if (!totpCode) throw new ApiError(401, "totp_required", "Enter your authenticator code");
      if (!admin.totpSecret || !(await verifyTotp(admin.totpSecret, totpCode))) {
        throw new ApiError(401, "totp_invalid", "Wrong authenticator code");
      }
    }

    await this.admins.touchLogin(admin.id, new Date());
    const token = await this.issueToken(admin);
    await this.audit.record({ adminId: admin.id, action: "admin.login", targetType: "admin_user", targetId: admin.id });
    return { token, admin: view(admin) };
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ changed: true }> {
    const admin = await this.admins.findById(adminId);
    if (!admin) throw notFound("admin");
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw new ApiError(401, "wrong_password", "Current password is incorrect");
    }
    if (newPassword.length < 10) {
      throw new ApiError(400, "weak_password", "Password must be at least 10 characters");
    }
    await this.admins.update(adminId, { passwordHash: await hashPassword(newPassword) });
    await this.audit.record({ adminId, action: "admin.change_password", targetType: "admin_user", targetId: adminId });
    return { changed: true };
  }

  /** Step 1 of 2FA enrollment: mint a secret (not yet enforced) + QR URI. */
  async setupTotp(adminId: string): Promise<{ secret: string; otpauth: string }> {
    const admin = await this.admins.findById(adminId);
    if (!admin) throw notFound("admin");
    if (admin.totpEnabled) throw conflict("totp_enabled", "2FA is already enabled");
    const secret = generateTotpSecret();
    await this.admins.update(adminId, { totpSecret: secret });
    return { secret, otpauth: otpauthUri(secret, admin.email) };
  }

  /** Step 2: confirm with a live code from the authenticator — then enforce. */
  async enableTotp(adminId: string, code: string): Promise<{ enabled: true }> {
    const admin = await this.admins.findById(adminId);
    if (!admin?.totpSecret) throw badRequest("totp_not_setup", "Call 2fa/setup first");
    if (!(await verifyTotp(admin.totpSecret, code))) {
      throw new ApiError(401, "totp_invalid", "Wrong authenticator code");
    }
    await this.admins.update(adminId, { totpEnabled: true });
    await this.audit.record({ adminId, action: "admin.2fa_enable", targetType: "admin_user", targetId: adminId });
    return { enabled: true };
  }

  /** Disable requires a valid current code (prevents hijack-disable). */
  async disableTotp(adminId: string, code: string): Promise<{ enabled: false }> {
    const admin = await this.admins.findById(adminId);
    if (!admin?.totpEnabled || !admin.totpSecret) {
      throw badRequest("totp_not_enabled", "2FA is not enabled");
    }
    if (!(await verifyTotp(admin.totpSecret, code))) {
      throw new ApiError(401, "totp_invalid", "Wrong authenticator code");
    }
    await this.admins.update(adminId, { totpEnabled: false, totpSecret: null });
    await this.audit.record({ adminId, action: "admin.2fa_disable", targetType: "admin_user", targetId: adminId });
    return { enabled: false };
  }

  private issueToken(admin: AdminUser): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return sign(
      { sub: admin.id, role: admin.role, typ: "admin", iat: nowSec, exp: nowSec + ADMIN_SESSION_TTL_SECONDS },
      this.env.JWT_SECRET,
    );
  }

  async getById(id: string): Promise<AdminView | undefined> {
    const admin = await this.admins.findById(id);
    return admin ? view(admin) : undefined;
  }
}
