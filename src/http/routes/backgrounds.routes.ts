import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const backgroundRoutes = new Hono<AppEnv>();

// Public — the shared text-post background catalog.
backgroundRoutes.get("/", async (c) => {
  const backgrounds = await c.get("container").backgrounds.listPublic();
  return c.json({ backgrounds: backgrounds.map((b) => ({ id: b.id })) });
});

// Public — a background image.
backgroundRoutes.get("/:id/image", async (c) => {
  const object = await c.get("container").backgrounds.openImage(c.req.param("id"));
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { status: 200, headers });
});

// Admin only (users.isAdmin) below.
backgroundRoutes.use("/*", requireAuth);

backgroundRoutes.post("/", async (c) => {
  const bg = await c.get("container").backgrounds.create(c.get("userId"));
  return c.json({ background: { id: bg.id } }, 201);
});

backgroundRoutes.put("/:id/image", async (c) => {
  const body = c.req.raw.body;
  if (!body) throw badRequest("empty_body", "Request body (image bytes) is required");
  const bg = await c
    .get("container")
    .backgrounds.attachImage(c.req.param("id"), c.get("userId"), body, c.req.header("content-type"));
  return c.json({ background: { id: bg.id } });
});

backgroundRoutes.delete("/:id", async (c) => {
  return c.json(await c.get("container").backgrounds.remove(c.req.param("id"), c.get("userId")));
});
