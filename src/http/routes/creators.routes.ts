import { Hono } from "hono";
import { conflict, notFound } from "../../services/errors";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { readJson, requireInt, requireString, requireParam } from "../util";
import { liveViewerCount } from '../../services/livekit';

export const creatorRoutes = new Hono<AppEnv>();

creatorRoutes.get('/me/live/:id/statement', requireAuth, async c => {
  c.header('Cache-Control', 'private, no-store');
  const statement = await c.get('container').creatorAnalytics.liveStatement(c.get('userId'), requireParam(c, 'id'));
  let connectedViewers: number | null = null;
  if (statement.status === 'live') {
    try { connectedViewers = await liveViewerCount(c.env, statement.eventId, c.get('userId')); } catch { /* Unknown is not zero. */ }
  }
  return c.json({ ...statement, connectedViewers, sampledAt: new Date().toISOString() });
});

creatorRoutes.get('/me/withdrawals', requireAuth, async c => {
  c.header('Cache-Control', 'private, no-store');
  return c.json(await c.get('container').payouts.withdrawalOverview(c.get('userId')));
});
creatorRoutes.post('/me/withdrawals/quote', requireAuth, async c => {
  const b = await readJson(c);
  return c.json(await c.get('container').payouts.quoteWithdrawal(c.get('userId'), requireInt(b, 'amountUgx'), requireString(b, 'provider')));
});
creatorRoutes.post('/me/withdrawals', requireAuth, async c => {
  const b = await readJson(c);
  return c.json(await c.get('container').payouts.requestWithdrawal(c.get('userId'), {
    requestId: requireString(b, 'requestId'), amountUgx: requireInt(b, 'amountUgx'), feeUgx: requireInt(b, 'feeUgx'), provider: requireString(b, 'provider'),
  }));
});

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
  return c.json({ creator: { id: creator.id, userId: creator.userId, verified: creator.verified, createdAt: creator.createdAt } });
});

// A creator's public published catalog (§4.2).
creatorRoutes.get("/:id/content", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const items = await c.get("container").content.listPublishedByCreator(c.req.param("id"), await getOptionalUserId(c));
  return c.json({ content: items });
});

// A creator's live events.
creatorRoutes.get("/:id/live", async (c) => {
  const events = await c.get("container").live.listByCreator(c.req.param("id"));
  return c.json({ live: events });
});
