import type { Env } from "../env";
import type { Container } from "./container";

/** Hono generics shared across the app: bindings + per-request variables. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    container: Container;
    /** Set by requireAuth on user-protected routes. */
    userId: string;
    /** Set by requireAdmin on admin-protected routes. */
    adminId: string;
    adminRole: "super_admin" | "finance" | "moderator" | "support" | "analyst";
  };
}
