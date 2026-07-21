import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import { AuthError } from "../services/auth.service";
import { ApiError } from "../services/errors";
import { createContainer } from "./container";
import { adminRoutes } from "./routes/admin.routes";
import { authRoutes } from "./routes/auth.routes";
import { contentRoutes } from "./routes/content.routes";
import { creatorRoutes } from "./routes/creators.routes";
import { liveRoutes } from "./routes/live.routes";
import { messageRoutes } from "./routes/messages.routes";
import { paymentsRoutes } from "./routes/payments.routes";
import { reportRoutes } from "./routes/reports.routes";
import { userRoutes } from "./routes/users.routes";
import type { AppEnv } from "./types";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Native apps ignore CORS; this is for web/dev tooling access.
  app.use("*", cors());

  // Build the repository/service graph once per request.
  app.use("*", async (c, next) => {
    c.set("container", createContainer(c.env));
    await next();
  });

  app.get("/health", async (c) => {
    try {
      await c.get("container").db.run(sql`select 1`);
      return c.json({ status: "ok", db: "up" });
    } catch (err) {
      return c.json({ status: "degraded", db: "down", error: String(err) }, 503);
    }
  });

  app.route("/auth", authRoutes);
  app.route("/users", userRoutes);
  app.route("/creators", creatorRoutes);
  app.route("/content", contentRoutes);
  app.route("/live", liveRoutes);
  app.route("/payments", paymentsRoutes);
  app.route("/reports", reportRoutes);
  app.route("/", messageRoutes);
  app.route("/admin", adminRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.code, message: err.message, detail: err.detail }, err.status);
    }
    if (err instanceof AuthError) {
      const status = err.code === "account_disabled" ? 403 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    console.error("unhandled error", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
