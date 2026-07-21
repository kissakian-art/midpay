import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { ApiError } from "../../services/errors";
import type { AppEnv } from "../types";

/**
 * requireAuth — verifies the Bearer session JWT and sets `userId` in context.
 * Reject with 401 on any failure. Mount on protected route groups.
 */
export async function requireAuth(c: Context<AppEnv>, next: Next): Promise<void> {
  const header = c.req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : undefined;
  if (!token) throw new ApiError(401, "unauthorized", "Missing bearer token");

  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string") {
      throw new ApiError(401, "unauthorized", "Malformed token");
    }
    c.set("userId", payload.sub);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, "unauthorized", "Invalid or expired token");
  }

  await next();
}

/**
 * Resolve the caller's userId if a valid Bearer token is present, else null.
 * Never throws — for endpoints that are public but personalize when signed in
 * (e.g. serving free media anonymously vs. gated paid media).
 */
export async function getOptionalUserId(c: Context<AppEnv>): Promise<string | null> {
  const header = c.req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : undefined;
  if (!token) return null;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
