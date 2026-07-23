import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalString, readJson, requireParam } from "../util";

export const userRoutes = new Hono<AppEnv>();

// --- Own profile editing. MUST be declared before "/:id" so the literal "me"
// isn't captured by the param route. ---

// Update display name / bio.
userRoutes.patch("/me", requireAuth, async (c) => {
  const body = await readJson(c);
  const user = await c.get("container").profile.update(c.get("userId"), {
    displayName: "displayName" in body ? optionalString(body, "displayName") ?? null : undefined,
    bio: "bio" in body ? optionalString(body, "bio") ?? null : undefined,
  });
  return c.json({ user });
});

// Upload/replace the profile picture (raw image bytes in the body).
userRoutes.put("/me/avatar", requireAuth, async (c) => {
  const body = c.req.raw.body;
  if (!body) throw badRequest("empty_body", "Request body (image bytes) is required");
  const user = await c
    .get("container")
    .profile.setAvatar(c.get("userId"), body, c.req.header("content-type"));
  return c.json({ user });
});

// Public avatar image.
userRoutes.get("/:id/avatar", async (c) => {
  const object = await c.get("container").profile.openAvatar(c.req.param("id"));
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  // The URL is stable but its content changes when the user re-uploads, so it
  // must NOT be immutable. Clients append ?v=<avatar key> to bust instantly.
  headers.set("cache-control", "public, max-age=60");
  return new Response(object.body, { status: 200, headers });
});

// Public profile. An optional bearer token adds isFollowing / isSelf so the
// client can render the right Follow button state immediately.
userRoutes.get("/:id", async (c) => {
  const viewerId = await getOptionalUserId(c);
  const profile = await c.get("container").social.profile(c.req.param("id"), viewerId);
  return c.json({ profile });
});

// A user's published posts (profile grid).
userRoutes.get("/:id/content", async (c) => {
  const content = await c.get("container").social.listUserContent(c.req.param("id"));
  return c.json({ content });
});

userRoutes.get("/:id/followers", async (c) => {
  return c.json({ followers: await c.get("container").social.listFollowers(c.req.param("id")) });
});

userRoutes.get("/:id/following", async (c) => {
  return c.json({ following: await c.get("container").social.listFollowing(c.req.param("id")) });
});

// Follow / unfollow (auth).
userRoutes.post("/:id/follow", requireAuth, async (c) => {
  return c.json(await c.get("container").social.follow(c.get("userId"), requireParam(c, "id")));
});

userRoutes.delete("/:id/follow", requireAuth, async (c) => {
  return c.json(await c.get("container").social.unfollow(c.get("userId"), requireParam(c, "id")));
});
