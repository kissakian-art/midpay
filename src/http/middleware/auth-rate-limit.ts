import type { Context, Next } from "hono";
import { AuthRateLimitRepository } from "../../repositories/auth-rate-limit.repository";
import { sha256Hex } from "../../services/crypto";
import { ApiError } from "../../services/errors";
import type { AppEnv } from "../types";
import { bodyLimit } from "hono/body-limit";

const limitAuthBody = bodyLimit({ maxSize: 16384, onError: () => { throw new ApiError(413, "body_too_large", "Request body is too large"); } });

export async function authRateLimit(c: Context<AppEnv>, next: Next): Promise<void> {
  const paths = ["/auth/signup", "/auth/login", "/auth/otp/request", "/auth/otp/verify", "/admin/auth/login", "/admin/bootstrap"];
  if (c.req.method !== "POST" || !paths.includes(c.req.path)) return next();
  // Bound the clone used for account throttling before parsing untrusted JSON.
  await limitAuthBody(c, async () => {});
  const repo = new AuthRateLimitRepository(c.get("container").db);
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!(await repo.attempt(await sha256Hex(`auth-ip:${ip}`), 60))) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  }
  const body = await c.req.raw.clone().json().catch(() => ({})) as Record<string, unknown>;
  const account = typeof body.phone === "string" ? body.phone.replace(/[^0-9]/g, "").replace(/^0/, "256") :
    typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  if (account && !(await repo.attempt(await sha256Hex(`auth-account:${account}`), 15))) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  }
  await next();
}
