import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getOptionalUserId } from "../middleware/auth";

export const searchRoutes = new Hono<AppEnv>();

// Public — one query across creators, posts, sounds and comments. ?q=<term>
searchRoutes.get("/", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const q = c.req.query("q") ?? "";
  return c.json(await c.get("container").search.run(q, await getOptionalUserId(c)));
});
