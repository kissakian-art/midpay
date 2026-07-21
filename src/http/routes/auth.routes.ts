import { Hono } from "hono";
import { notFound } from "../../services/errors";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { readJson, requireString } from "../util";

export const authRoutes = new Hono<AppEnv>();

// Step 1 — request an OTP for a phone number.
authRoutes.post("/otp/request", async (c) => {
  const body = await readJson(c);
  const phone = requireString(body, "phone");
  const result = await c.get("container").auth.requestOtp(phone);
  return c.json(result);
});

// Step 2 — verify the OTP; returns a session token + user.
authRoutes.post("/otp/verify", async (c) => {
  const body = await readJson(c);
  const phone = requireString(body, "phone");
  const code = requireString(body, "code");
  const { token, user, isNew } = await c.get("container").auth.verifyOtp(phone, code);
  return c.json({ token, user, isNew });
});

// Current user.
authRoutes.get("/me", requireAuth, async (c) => {
  const user = await c.get("container").users.findById(c.get("userId"));
  if (!user) throw notFound("user");
  return c.json({ user });
});
