import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalString, readJson, requireString } from "../util";

export const reportRoutes = new Hono<AppEnv>();

// A signed-in user reports a content item, live event, comment, or user (§7.4).
reportRoutes.post("/", requireAuth, async (c) => {
  const body = await readJson(c);
  const report = await c.get("container").moderation.report(c.get("userId"), {
    targetType: requireString(body, "targetType"),
    targetId: requireString(body, "targetId"),
    reason: optionalString(body, "reason"),
  });
  return c.json({ report }, 201);
});
