import { Hono } from "hono";
import { verify } from "hono/jwt";
import { ApiError, badRequest } from "../../services/errors";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalInt, optionalString, readJson, requireInt, requireParam } from "../util";

export const liveRoutes = new Hono<AppEnv>();

// WebSocket chat for a live event (§2.4 Durable Objects). Auth rides a `token`
// query param because browser WebSocket clients cannot set headers.
//   ws://host/live/:id/chat?token=<session JWT>
liveRoutes.get("/:id/chat", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw badRequest("expected_websocket", "This endpoint expects a WebSocket upgrade");
  }
  const token = c.req.query("token");
  if (!token) throw new ApiError(401, "unauthorized", "token query param required");
  let userId: string;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string") throw new Error("bad sub");
    userId = payload.sub;
  } catch {
    throw new ApiError(401, "unauthorized", "Invalid or expired token");
  }

  const eventId = requireParam(c, "id");
  const { live, users } = c.get("container");
  const event = await live.get(eventId); // 404 if missing
  if (event.status !== "live" && event.status !== "scheduled") {
    throw badRequest("not_live", `Event is ${event.status}`);
  }
  const user = await users.findById(userId);
  if (!user || user.status !== "active") throw new ApiError(401, "unauthorized", "Account unavailable");

  const stub = c.env.LIVE_ROOM.get(c.env.LIVE_ROOM.idFromName(eventId));
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-user-handle", user.handle);
  headers.set("x-live-event-id", eventId);
  return stub.fetch("https://live-room/connect", { headers });
});

// Current viewer count for a live event (public; §7.6 per-event economics).
liveRoutes.get("/:id/chat/stats", async (c) => {
  const eventId = requireParam(c, "id");
  await c.get("container").live.get(eventId);
  const stub = c.env.LIVE_ROOM.get(c.env.LIVE_ROOM.idFromName(eventId));
  return stub.fetch("https://live-room/stats");
});

// Public — preview the §3.3 price floor for a declared duration (UI helper).
liveRoutes.post("/quote-floor", async (c) => {
  const body = await readJson(c);
  const quote = await c.get("container").live.quoteFloor(requireInt(body, "declaredDurationMin"));
  return c.json(quote);
});

// Public — everyone currently broadcasting (discovery). Registered BEFORE
// "/:id" so "active" is not captured as an event id.
liveRoutes.get("/active", async (c) => {
  const lives = await c.get("container").live.listActive();
  return c.json({ lives });
});

// Public, personalized — fetch a live event with the caller's access flags
// (owned/isOwner) resolved when a valid token is present.
liveRoutes.get("/:id", async (c) => {
  const userId = await getOptionalUserId(c);
  const event = await c.get("container").live.getForViewer(c.req.param("id"), userId);
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
