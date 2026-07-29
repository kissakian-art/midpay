import { Hono } from "hono";
import { conflict, notFound } from "../../services/errors";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const creatorRoutes = new Hono<AppEnv>();

// Become a creator — instant, no approval (open-signup model). Payouts go to
// the phone number used at registration (Betpawa-style); there is no separate
// payout number to set.
creatorRoutes.post("/apply", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { creators } = c.get("container");
  const existing = await creators.findByUserId(userId);
  if (existing) throw conflict("already_creator", "You already have a creator profile");
  const creator = await creators.create({ userId });
  return c.json({ creator }, 201);
});

// The signed-in creator's own analytics dashboard (§7.7 creator view): earnings
// over a window, per-post performance, and live-session reach. Registered BEFORE
// "/:id" so "me" isn't captured as a creator id.
creatorRoutes.get("/me/analytics", requireAuth, async (c) => {
  const q = c.req.query("range");
  const range = q === "day" || q === "all" ? q : "week";
  const data = await c.get("container").creatorAnalytics.forUser(c.get("userId"), range);
  return c.json(data);
});

// Public creator profile.
creatorRoutes.get("/:id", async (c) => {
  const creator = await c.get("container").creators.findById(c.req.param("id"));
  if (!creator) throw notFound("creator");
  return c.json({ creator });
});

// A creator's public published catalog (§4.2).
creatorRoutes.get("/:id/content", async (c) => {
  const items = await c.get("container").content.listPublishedByCreator(c.req.param("id"));
  return c.json({ content: items });
});

// A creator's live events.
creatorRoutes.get("/:id/live", async (c) => {
  const events = await c.get("container").live.listByCreator(c.req.param("id"));
  return c.json({ live: events });
});
