import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { ApiError, forbidden } from "../../services/errors";
import type { AppEnv } from "../types";

type AdminRole = AppEnv["Variables"]["adminRole"];

/** Verify an admin session JWT (typ:"admin") and set adminId/adminRole. */
export async function requireAdmin(c: Context<AppEnv>, next: Next): Promise<void> {
  const header = c.req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : undefined;
  if (!token) throw new ApiError(401, "unauthorized", "Missing bearer token");

  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    if (payload.typ !== "admin" || typeof payload.sub !== "string") {
      throw new ApiError(401, "unauthorized", "Not an admin token");
    }
    c.set("adminId", payload.sub);
    c.set("adminRole", payload.role as AdminRole);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, "unauthorized", "Invalid or expired token");
  }

  await next();
}

/** Gate a route to specific admin roles (RBAC, §7.1). Super Admin always passes. */
export function requireRole(...roles: AdminRole[]) {
  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    const role = c.get("adminRole");
    if (role !== "super_admin" && !roles.includes(role)) {
      throw forbidden(`requires role: ${roles.join(" or ")}`);
    }
    await next();
  };
}
