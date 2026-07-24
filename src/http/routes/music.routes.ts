import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalInt, optionalString, readJson, requireString } from "../util";

export const musicRoutes = new Hono<AppEnv>();

/** Parse an HTTP Range header ("bytes=start-end") into an R2Range, if present. */
function parseRange(header: string | undefined): R2Range | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return undefined;
  if (startStr === "") return { suffix: Number(endStr) };
  const offset = Number(startStr);
  if (endStr === "") return { offset };
  return { offset, length: Number(endStr) - offset + 1 };
}

// Public — the shared track library for the picker. ?q=<search>&limit=40.
// A bearer token (optional) also surfaces the caller's own tracks.
musicRoutes.get("/tracks", async (c) => {
  const viewerId = await getOptionalUserId(c);
  const q = c.req.query("q") ?? undefined;
  const limit = Number(c.req.query("limit") ?? 40) || 40;
  const tracks = await c.get("container").music.listAvailable(viewerId, q, limit);
  return c.json({ tracks });
});

// Public — stream a track's audio (music is meant to be heard). Supports Range.
musicRoutes.get("/tracks/:id/audio", async (c) => {
  const range = parseRange(c.req.header("range"));
  const object = await c.get("container").music.openAudio(c.req.param("id"), range);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  if (range && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
});

// Everything below requires auth.
musicRoutes.use("/*", requireAuth);

// Create a track (metadata). Audio bytes are uploaded separately.
musicRoutes.post("/tracks", async (c) => {
  const body = await readJson(c);
  const track = await c.get("container").music.createTrack(c.get("userId"), {
    title: requireString(body, "title"),
    artist: optionalString(body, "artist"),
    durationSeconds: optionalInt(body, "durationSeconds"),
  });
  return c.json({ track }, 201);
});

// Upload / replace a track's audio bytes (owner only).
musicRoutes.put("/tracks/:id/audio", async (c) => {
  const body = c.req.raw.body;
  if (!body) throw badRequest("empty_body", "Request body (audio bytes) is required");
  const track = await c
    .get("container")
    .music.attachAudio(c.req.param("id"), c.get("userId"), body, c.req.header("content-type"));
  return c.json({ track });
});
