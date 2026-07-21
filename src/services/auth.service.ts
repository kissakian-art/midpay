import { sign } from "hono/jwt";
import type { User } from "../db/schema";
import type { Env } from "../env";
import { OtpRepository } from "../repositories/otp.repository";
import { UserRepository } from "../repositories/user.repository";
import { ConfigService } from "./config.service";
import { randomNumericCode, sha256Hex, timingSafeEqual } from "./crypto";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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
 * SMS delivery: Phase-1 scaffold has no SMS provider wired, so the code is
 * logged (and, in development, returned to the caller) instead of texted. Swap
 * `sendSms` for a real provider (e.g. Africa's Talking / Twilio) at launch.
 */
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly otps: OtpRepository,
    private readonly config: ConfigService,
    private readonly env: Env,
  ) {}

  private isDev(): boolean {
    return this.env.ENVIRONMENT !== "production";
  }

  private async sendSms(phone: string, code: string): Promise<void> {
    // TODO(launch): integrate a Ugandan SMS/OTP provider. For now, log only.
    console.log(`[otp] would send code ${code} to ${phone}`);
  }

  /** Step 1 — issue an OTP challenge for a phone number. */
  async requestOtp(
    phoneRaw: string,
  ): Promise<{ challengeId: string; devCode?: string; bypass?: boolean }> {
    const phone = normalizePhone(phoneRaw);

    // Verification disabled (admin config, dev only): no challenge, no SMS —
    // the client can call verify with any code.
    if (!(await this.config.phoneVerificationEnabled())) {
      return { challengeId: "verification-disabled", bypass: true };
    }

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

    // Bypass mode (admin config PHONE_VERIFICATION_ENABLED=0, dev only): skip
    // the code check entirely and log in / register the phone directly.
    if (!(await this.config.phoneVerificationEnabled())) {
      return this.loginOrRegister(phone, now);
    }

    const challenge = await this.otps.findActiveByPhone(phone, now);
    if (!challenge) throw new AuthError("otp_not_found", "No active code; request a new one.");
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AuthError("otp_locked", "Too many attempts; request a new code.");
    }

    const ok = timingSafeEqual(challenge.codeHash, await sha256Hex(code));
    if (!ok) {
      await this.otps.incrementAttempts(challenge.id, challenge.attempts + 1);
      throw new AuthError("otp_invalid", "Incorrect code.");
    }
    await this.otps.markConsumed(challenge.id, now);

    return this.loginOrRegister(phone, now);
  }

  /** Shared find-or-create + token issue used by both verified and bypass paths. */
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
      { sub: userId, iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS },
      this.env.JWT_SECRET,
    );
  }
}

/** Normalize UG numbers toward E.164-ish form. Lightweight; refine at launch. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[\s-]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("0")) return `+256${trimmed.slice(1)}`;
  if (trimmed.startsWith("256")) return `+${trimmed}`;
  return trimmed;
}
