import { sign } from "hono/jwt";
import type { AdminUser } from "../../db/schema";
import type { Env } from "../../env";
import { AdminRepository } from "../../repositories/admin.repository";
import { AuditRepository } from "../../repositories/audit.repository";
import { ApiError, conflict, forbidden } from "../errors";
import { hashPassword, verifyPassword } from "../crypto";

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

  async login(email: string, password: string): Promise<{ token: string; admin: AdminView }> {
    const admin = await this.admins.findByEmail(email);
    // Constant-ish failure regardless of whether the email exists.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : false;
    if (!admin || !ok) throw new ApiError(401, "invalid_credentials", "Wrong email or password");
    if (admin.status !== "active") throw forbidden("admin account is disabled");

    await this.admins.touchLogin(admin.id, new Date());
    const token = await this.issueToken(admin);
    await this.audit.record({ adminId: admin.id, action: "admin.login", targetType: "admin_user", targetId: admin.id });
    return { token, admin: view(admin) };
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
