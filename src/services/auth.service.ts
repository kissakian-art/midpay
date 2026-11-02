import { sign } from "hono/jwt";
import type { User } from "../db/schema";
import type { Env } from "../env";
import { OtpRepository } from "../repositories/otp.repository";
import { UserRepository } from "../repositories/user.repository";
import { ConfigService } from "./config.service";
import { hashPassword, randomNumericCode, sha256Hex, timingSafeEqual, verifyPassword } from "./crypto";
import { ApiError } from "./errors";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Strip secrets before a user object is sent to any client. */
export function publicUser(u: User): Omit<User, "passwordHash"> {
  const { passwordHash: _p, ...rest } = u;
  return rest;
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * AuthService — phone-based OTP login/signup (§3.1 phone-centric identity).
 *
 * SMS remains unconfigured. Codes are returned only in explicit development;
 * production signup and OTP endpoints fail closed until an adapter is added.
 */
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly otps: OtpRepository,
    private readonly config: ConfigService,
    private readonly env: Env,
  ) {}

  private isDev(): boolean {
    return this.env.ENVIRONMENT === "development";
  }

  private async sendSms(phone: string, code: string): Promise<void> {
    // A real SMS adapter is required for production. Never log codes or phones.
    void phone;
    void code;
    if (!this.isDev()) throw new ApiError(503, "sms_unconfigured", "Phone verification is not configured yet");
  }

  // --- Mobile + password auth (primary; OTP kept for legacy/transition) ---

  /** A first password can only be set after proving ownership of the phone. */
  async signup(
    phoneRaw: string,
    password: string,
    code?: string,
  ): Promise<{ token: string; user: User; isNew: boolean }> {
    const phone = normalizePhone(phoneRaw);
    if (!this.isDev()) throw new ApiError(503, "sms_unconfigured", "Signup requires phone verification, which is not configured yet");
    if (!password || password.length < 6) {
      throw new AuthError("weak_password", "Password must be at least 6 characters.");
    }
    const now = new Date();
    const existing = await this.users.findByPhone(phone);
    if (existing?.passwordHash) {
      throw new AuthError("already_registered", "This number is already registered. Log in instead.");
    }
    if (existing && existing.status !== "active") throw new AuthError("account_disabled", "Account unavailable.");
    // Legacy accounts always require a real challenge, even in bypass mode.
    const verified = await this.provePhone(phone, code, !!existing);
    if (existing) {
      const updated = await this.users.setFirstPassword(existing.id, await hashPassword(password), now);
      if (!updated) throw new AuthError("already_registered", "A password has already been set. Log in instead.");
      return { token: await this.issueToken(existing.id), user: updated, isNew: false };
    }
    const user = await this.users.create({
      phone,
      handle: `user_${crypto.randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword(password),
      phoneVerifiedAt: verified ? now : null,
    });
    return { token: await this.issueToken(user.id), user, isNew: true };
  }

  /** Log in with a mobile number + password. */
  async loginWithPassword(
    phoneRaw: string,
    password: string,
  ): Promise<{ token: string; user: User }> {
    const phone = normalizePhone(phoneRaw);
    const user = await this.users.findByPhone(phone);
    if (user && !user.passwordHash) {
      throw new AuthError("no_password", "Verify this number during signup to set your first password.");
    }
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) throw new AuthError("invalid_credentials", "Wrong number or password.");
    if (user.status !== "active") throw new AuthError("account_disabled", `Account is ${user.status}.`);
    return { token: await this.issueToken(user.id), user };
  }

  /** Step 1 — issue an OTP challenge for a phone number. */
  async requestOtp(
    phoneRaw: string,
  ): Promise<{ challengeId: string; devCode?: string; bypass?: boolean }> {
    const phone = normalizePhone(phoneRaw);

    // Bypass only supports NEW development accounts. Legacy password setup
    // still needs a challenge; it never trusts an arbitrary phone number.
    const existing = await this.users.findByPhone(phone);
    if (!(await this.config.phoneVerificationEnabled()) && !existing) {
      return { challengeId: "verification-disabled", bypass: true };
    }

    if (!this.isDev()) throw new ApiError(503, "sms_unconfigured", "Phone verification is not configured yet");

    const code = randomNumericCode(6);
    const challenge = await this.otps.create({
      phone,
      codeHash: await sha256Hex(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    await this.sendSms(phone, code);
    return {
      challengeId: challenge.id,
      // Only leak the code in development so you can test end-to-end.
      ...(this.isDev() ? { devCode: code } : {}),
    };
  }

  /** Step 2 — verify the code; find-or-create the user; issue a session JWT. */
  async verifyOtp(
    phoneRaw: string,
    code: string,
  ): Promise<{ token: string; user: User; isNew: boolean }> {
    const phone = normalizePhone(phoneRaw);
    const now = new Date();
    if (!this.isDev()) throw new ApiError(503, "sms_unconfigured", "Phone verification is not configured yet");

    // Bypass mode never authenticates an arbitrary existing account.
    if (!(await this.config.phoneVerificationEnabled())) {
      throw new AuthError("otp_disabled", "Use mobile number and password to sign in.");
    }

    await this.provePhone(phone, code, true);
    return this.loginOrRegister(phone, now);
  }

  private async provePhone(phone: string, code: string | undefined, required: boolean): Promise<boolean> {
    if (!required && !(await this.config.phoneVerificationEnabled())) return false;
    if (!code) throw new AuthError("verification_required", "Request a verification code for this number first.");
    const now = new Date();

    const challenge = await this.otps.findActiveByPhone(phone, now);
    if (!challenge) throw new AuthError("otp_not_found", "No active code; request a new one.");
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AuthError("otp_locked", "Too many attempts; request a new code.");
    }

    const ok = timingSafeEqual(challenge.codeHash, await sha256Hex(code));
    if (!ok) {
      await this.otps.incrementAttempts(challenge.id);
      throw new AuthError("otp_invalid", "Incorrect code.");
    }
    if (!(await this.otps.consume(challenge.id, now, OTP_MAX_ATTEMPTS))) {
      throw new AuthError("otp_invalid", "Code has expired or was already used.");
    }
    return true;
  }

  /** Shared find-or-create + token issue after a consumed OTP challenge. */
  private async loginOrRegister(
    phone: string,
    now: Date,
  ): Promise<{ token: string; user: User; isNew: boolean }> {
    let user = await this.users.findByPhone(phone);
    const isNew = !user;
    if (!user) {
      user = await this.users.create({
        phone,
        handle: `user_${crypto.randomUUID().slice(0, 8)}`,
        phoneVerifiedAt: now,
      });
    } else if (!user.phoneVerifiedAt) {
      user = (await this.users.update(user.id, { phoneVerifiedAt: now })) ?? user;
    }

    if (user.status !== "active") {
      throw new AuthError("account_disabled", `Account is ${user.status}.`);
    }

    const token = await this.issueToken(user.id);
    return { token, user, isNew };
  }

  private issueToken(userId: string): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return sign(
      { sub: userId, typ: "user", iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS },
      this.env.JWT_SECRET,
    );
  }
}

/** Normalize UG numbers toward E.164-ish form. Lightweight; refine at launch. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()-]/g, "");
  const phone = trimmed.startsWith("0") ? `+256${trimmed.slice(1)}` : trimmed.startsWith("256") ? `+${trimmed}` : trimmed;
  if (!/^\+256[37]\d{8}$/.test(phone)) throw new AuthError("invalid_phone", "Enter a valid Ugandan mobile number.");
  return phone;
}
