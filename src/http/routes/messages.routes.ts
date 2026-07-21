import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { readJson, requireParam, requireString } from "../util";

// Inbox + DMs. Auth is applied PER ROUTE (not use("/*")) because this group is
// mounted at "/" — a root wildcard middleware would leak onto every route
// registered after it (it broke /admin/* once; don't reintroduce it).
export const messageRoutes = new Hono<AppEnv>();

// Send a DM (finds-or-creates the 1:1 conversation).
messageRoutes.post("/messages", requireAuth, async (c) => {
  const body = await readJson(c);
  const message = await c.get("container").messaging.send(
    c.get("userId"),
    requireString(body, "toUserId"),
    requireString(body, "body"),
  );
  return c.json({ message }, 201);
});

// Inbox: my conversations, newest first, with unread counts.
messageRoutes.get("/conversations", requireAuth, async (c) => {
  return c.json({ conversations: await c.get("container").messaging.listConversations(c.get("userId")) });
});

messageRoutes.get("/conversations/:id/messages", requireAuth, async (c) => {
  const messages = await c
    .get("container")
    .messaging.listMessages(c.get("userId"), requireParam(c, "id"));
  return c.json({ messages });
});

messageRoutes.post("/conversations/:id/read", requireAuth, async (c) => {
  return c.json(await c.get("container").messaging.markRead(c.get("userId"), requireParam(c, "id")));
});
