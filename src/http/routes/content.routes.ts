import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalInt, optionalString, readJson } from "../util";

export const contentRoutes = new Hono<AppEnv>();

// Public — the global feed (newest published first). ?limit=20&before=<unixSec>
// A valid bearer token (optional) decorates paid items with `owned`.
contentRoutes.get("/feed", async (c) => {
  const limit = Number(c.req.query("limit") ?? 20) || 20;
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined;
  const viewerId = await getOptionalUserId(c);
  return c.json({ feed: await c.get("container").content.feed(limit, before, viewerId) });
});

// Public — the post's cover thumbnail (video first-frame / photo). Always
// public, even for paid content: the thumbnail is the sales cover, not the
// paywalled media itself.
contentRoutes.get("/:id/thumbnail", async (c) => {
  const object = await c.get("container").content.openThumbnail(c.req.param("id"));
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  headers.set("cache-control", "public, max-age=300");
  return new Response(object.body, { status: 200, headers });
});

// Public — fetch a single content item's metadata.
contentRoutes.get("/:id", async (c) => {
  const item = await c.get("container").content.getForViewer(c.req.param("id"));
  return c.json({ content: item });
});

/** Parse an HTTP Range header ("bytes=start-end") into an R2Range, if present. */
function parseRange(header: string | undefined): R2Range | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return undefined;
  if (startStr === "") return { suffix: Number(endStr) }; // last N bytes
  const offset = Number(startStr);
  if (endStr === "") return { offset };
  return { offset, length: Number(endStr) - offset + 1 };
}

// Public — stream the media object, access-gated (free = open, paid = requires
// an entitlement; §4.4/§4.5). Supports HTTP Range for video seeking.
contentRoutes.get("/:id/media", async (c) => {
  const userId = await getOptionalUserId(c);
  const requestedRange = parseRange(c.req.header("range"));
  const { object } = await c
    .get("container")
    .content.openMedia(c.req.param("id"), userId, requestedRange);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");

  // Only respond 206 when the CLIENT asked for a range. R2 may report a
  // `range` on the object even for a full read, so gate on the request.
  if (requestedRange && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
});

// Public — list comments on a content item (§ social).
contentRoutes.get("/:id/comments", async (c) => {
  return c.json({ comments: await c.get("container").social.listComments(c.req.param("id")) });
});

// Everything below requires auth (creator + social actions).
contentRoutes.use("/*", requireAuth);

// Likes.
contentRoutes.post("/:id/like", async (c) => {
  return c.json(await c.get("container").social.like(c.get("userId"), c.req.param("id")));
});
contentRoutes.delete("/:id/like", async (c) => {
  return c.json(await c.get("container").social.unlike(c.get("userId"), c.req.param("id")));
});

// Comments.
contentRoutes.post("/:id/comments", async (c) => {
  const body = await readJson(c);
  const comment = await c.get("container").social.addComment(
    c.get("userId"),
    c.req.param("id"),
    optionalString(body, "body") ?? "",
    optionalString(body, "parentId"),
  );
  return c.json({ comment }, 201);
});
contentRoutes.delete("/:id/comments/:commentId", async (c) => {
  return c.json(
    await c
      .get("container")
      .social.deleteComment(c.get("userId"), c.req.param("id"), c.req.param("commentId")),
  );
});

function readPricing(body: Record<string, unknown>): "free" | "paid" | undefined {
  const v = optionalString(body, "pricing");
  if (v === undefined) return undefined;
  if (v !== "free" && v !== "paid") throw badRequest("bad_pricing", "pricing must be 'free' or 'paid'");
  return v;
}

const HEX = /^#([0-9a-fA-F]{3,8})$/;

/**
 * Parse + SANITIZE creator text overlays. Untrusted client input, so everything
 * is clamped: count/text length capped, coords/size clamped to sane ranges, and
 * colours restricted to hex. Returns undefined when the field is absent (leave
 * as-is on update); an empty/invalid array becomes [] (clears overlays).
 */
function readOverlays(body: Record<string, unknown>): import("../../db/schema").TextOverlay[] | undefined {
  const raw = body["overlays"];
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("bad_overlays", "overlays must be an array");

  const num = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const hex = (v: unknown, d: string | null): string | null =>
    typeof v === "string" && HEX.test(v) ? v : d;

  return raw
    .slice(0, 12)
    .map((o) => {
      const obj = (o ?? {}) as Record<string, unknown>;
      const text = typeof obj.text === "string" ? obj.text.slice(0, 200) : "";
      return {
        text,
        x: num(obj.x, 0, 1, 0.05),
        y: num(obj.y, 0, 1, 0.05),
        size: num(obj.size, 0.02, 0.25, 0.06),
        color: hex(obj.color, "#ffffff") ?? "#ffffff",
        bg: obj.bg === null || obj.bg === undefined ? null : hex(obj.bg, null),
      };
    })
    .filter((o) => o.text.trim().length > 0);
}

/** Parse + sanitize a text post's visual style (untrusted input). */
function readTextStyle(body: Record<string, unknown>): import("../../db/schema").TextStyle | undefined {
  const raw = body["textStyle"];
  if (raw === undefined) return undefined;
  if (raw === null) return undefined;
  if (typeof raw !== "object") throw badRequest("bad_text_style", "textStyle must be an object");
  const obj = raw as Record<string, unknown>;
  const hex = (v: unknown, d: string): string => (typeof v === "string" && HEX.test(v) ? v : d);
  const bgIn = Array.isArray(obj.bg) ? obj.bg : [];
  const bg = bgIn.slice(0, 3).map((c) => hex(c, "#000000"));
  const align = obj.align === "left" || obj.align === "right" ? obj.align : "center";
  return {
    bg: bg.length ? bg : ["#111111"],
    color: hex(obj.color, "#ffffff"),
    font: typeof obj.font === "string" ? obj.font.slice(0, 40) : null,
    align,
    bold: obj.bold === true,
  };
}

// Create content metadata (media itself is uploaded to R2 separately).
contentRoutes.post("/", async (c) => {
  const body = await readJson(c);
  const kindRaw = optionalString(body, "kind");
  if (kindRaw !== undefined && kindRaw !== "video" && kindRaw !== "photo" && kindRaw !== "text") {
    throw badRequest("bad_kind", "kind must be 'video', 'photo' or 'text'");
  }
  const item = await c.get("container").content.create(c.get("userId"), {
    kind: kindRaw,
    title: optionalString(body, "title"),
    description: optionalString(body, "description"),
    r2Key: optionalString(body, "r2Key"),
    thumbnailR2Key: optionalString(body, "thumbnailR2Key"),
    durationSeconds: optionalInt(body, "durationSeconds"),
    sizeBytes: optionalInt(body, "sizeBytes"),
    pricing: readPricing(body),
    priceUgx: optionalInt(body, "priceUgx"),
    overlays: readOverlays(body),
    textStyle: readTextStyle(body),
    musicTrackId: optionalString(body, "musicTrackId"),
    musicStartMs: optionalInt(body, "musicStartMs"),
    musicEndMs: optionalInt(body, "musicEndMs"),
  });
  return c.json({ content: item }, 201);
});

// Update metadata / pricing status (§4.5.1).
contentRoutes.patch("/:id", async (c) => {
  const body = await readJson(c);
  const item = await c.get("container").content.update(c.req.param("id"), c.get("userId"), {
    title: optionalString(body, "title"),
    description: optionalString(body, "description"),
    pricing: readPricing(body),
    priceUgx: optionalInt(body, "priceUgx"),
    overlays: readOverlays(body),
    textStyle: readTextStyle(body),
    musicTrackId: optionalString(body, "musicTrackId"),
    musicStartMs: optionalInt(body, "musicStartMs"),
    musicEndMs: optionalInt(body, "musicEndMs"),
  });
  return c.json({ content: item });
});

contentRoutes.post("/:id/publish", async (c) => {
  const item = await c.get("container").content.publish(c.req.param("id"), c.get("userId"));
  return c.json({ content: item });
});

// Archive / unpublish — reversible; buyers keep access (§4.5.5).
contentRoutes.post("/:id/archive", async (c) => {
  const item = await c.get("container").content.archive(c.req.param("id"), c.get("userId"));
  return c.json({ content: item });
});

contentRoutes.post("/:id/unarchive", async (c) => {
  const item = await c.get("container").content.unarchive(c.req.param("id"), c.get("userId"));
  return c.json({ content: item });
});

// Upload / replace the primary media object (raw bytes in the request body).
// On-device-encoded media is PUT straight to R2 via the Worker (§2.2).
contentRoutes.put("/:id/media", async (c) => {
  const body = c.req.raw.body;
  if (!body) throw badRequest("empty_body", "Request body (media bytes) is required");
  const item = await c
    .get("container")
    .content.attachMedia(c.req.param("id"), c.get("userId"), body, c.req.header("content-type"));
  return c.json({ content: item });
});

// Upload / replace the thumbnail object.
contentRoutes.put("/:id/thumbnail", async (c) => {
  const body = c.req.raw.body;
  if (!body) throw badRequest("empty_body", "Request body (image bytes) is required");
  const item = await c
    .get("container")
    .content.attachThumbnail(c.req.param("id"), c.get("userId"), body, c.req.header("content-type"));
  return c.json({ content: item });
});

// Hard-delete — revokes buyer access; ledger is retained (§4.5.5).
contentRoutes.delete("/:id", async (c) => {
  const result = await c.get("container").content.hardDelete(c.req.param("id"), c.get("userId"));
  return c.json(result);
});
