import { Hono } from "hono";
import type { AppEnv } from "../types";

export const searchRoutes = new Hono<AppEnv>();

// Public — one query across creators, posts, sounds and comments. ?q=<term>
searchRoutes.get("/", async (c) => {
  const q = c.req.query("q") ?? "";
  return c.json(await c.get("container").search.run(q));
});
