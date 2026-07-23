import { Hono } from "hono";
import { getOptionalUserId, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { requireParam } from "../util";

export const userRoutes = new Hono<AppEnv>();

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
