import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { requireParam } from "../util";

export const userRoutes = new Hono<AppEnv>();

// Public profile with follower/following counts.
userRoutes.get("/:id", async (c) => {
  const profile = await c.get("container").social.profile(c.req.param("id"));
  return c.json({ profile });
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
