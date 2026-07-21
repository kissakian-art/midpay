import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import type { WebhookPayload } from "../../services/payments/payments.service";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
import { optionalString, readJson, requireString } from "../util";

export const paymentsRoutes = new Hono<AppEnv>();

// Start a purchase — creates a pending ledger row and fires the STK Push (§3.1).
paymentsRoutes.post("/checkout", requireAuth, async (c) => {
  const body = await readJson(c);
  const type = requireString(body, "type");
  if (type !== "video_unlock" && type !== "live_ticket") {
    throw badRequest("bad_type", "type must be 'video_unlock' or 'live_ticket'");
  }
  const result = await c.get("container").payments.checkout(c.get("userId"), {
    type,
    targetId: requireString(body, "targetId"),
    phone: optionalString(body, "phone"),
  });
  return c.json(result, 201);
});

// Flutterwave webhook — settles a charge (§3.1). Auth is by the verif-hash
// header, NOT a session token, so this route is intentionally unauthenticated.
paymentsRoutes.post("/webhook", async (c) => {
  const verifHash = c.req.header("verif-hash");
  const payload = (await c.req.json().catch(() => ({}))) as WebhookPayload;
  const result = await c.get("container").payments.settleFromWebhook(payload, verifHash);
  return c.json(result);
});
