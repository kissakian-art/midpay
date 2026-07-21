import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalInt, optionalString, readJson, requireInt } from "../util";

export const liveRoutes = new Hono<AppEnv>();

// Public — preview the §3.3 price floor for a declared duration (UI helper).
liveRoutes.post("/quote-floor", async (c) => {
  const body = await readJson(c);
  const quote = await c.get("container").live.quoteFloor(requireInt(body, "declaredDurationMin"));
  return c.json(quote);
});

// Public — fetch a live event.
liveRoutes.get("/:id", async (c) => {
  const event = await c.get("container").live.get(c.req.param("id"));
  return c.json({ live: event });
});

liveRoutes.use("/*", requireAuth);

// Schedule a live — enforces the §3.3 duration-based price floor server-side.
liveRoutes.post("/", async (c) => {
  const body = await readJson(c);
  const event = await c.get("container").live.schedule(c.get("userId"), {
    title: optionalString(body, "title"),
    description: optionalString(body, "description"),
    declaredDurationMin: requireInt(body, "declaredDurationMin"),
    ticketPriceUgx: requireInt(body, "ticketPriceUgx"),
    scheduledStartAt: optionalInt(body, "scheduledStartAt"),
  });
  return c.json({ live: event }, 201);
});

liveRoutes.post("/:id/start", async (c) => {
  const event = await c.get("container").live.start(c.req.param("id"), c.get("userId"));
  return c.json({ live: event });
});

liveRoutes.post("/:id/end", async (c) => {
  const event = await c.get("container").live.end(c.req.param("id"), c.get("userId"));
  return c.json({ live: event });
});
