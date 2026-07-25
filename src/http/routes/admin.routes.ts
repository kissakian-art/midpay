import { Hono } from "hono";
import { badRequest } from "../../services/errors";
import { requireAdmin, requireRole } from "../middleware/admin-auth";
import type { AppEnv } from "../types";
import { optionalInt, readJson, requireParam, requireString } from "../util";

export const adminRoutes = new Hono<AppEnv>();

// --- Auth (§7.1) ---
// First-run bootstrap: creates the initial Super Admin only if none exist.
adminRoutes.post("/bootstrap", async (c) => {
  const body = await readJson(c);
  const admin = await c.get("container").adminAuth.bootstrap(
    requireString(body, "email"),
    requireString(body, "password"),
    // displayName is optional
    (body.displayName as string | undefined) ?? undefined,
  );
  return c.json({ admin }, 201);
});

adminRoutes.post("/auth/login", async (c) => {
  const body = await readJson(c);
  const result = await c.get("container").adminAuth.login(
    requireString(body, "email"),
    requireString(body, "password"),
    typeof body.totpCode === "string" ? body.totpCode : undefined,
  );
  return c.json(result);
});

adminRoutes.post("/auth/change-password", requireAdmin, async (c) => {
  const body = await readJson(c);
  const result = await c.get("container").adminAuth.changePassword(
    c.get("adminId"),
    requireString(body, "currentPassword"),
    requireString(body, "newPassword"),
  );
  return c.json(result);
});

// 2FA enrollment (§7.1): setup → scan QR → enable with a live code.
adminRoutes.post("/2fa/setup", requireAdmin, async (c) => {
  return c.json(await c.get("container").adminAuth.setupTotp(c.get("adminId")));
});
adminRoutes.post("/2fa/enable", requireAdmin, async (c) => {
  const body = await readJson(c);
  return c.json(await c.get("container").adminAuth.enableTotp(c.get("adminId"), requireString(body, "code")));
});
adminRoutes.post("/2fa/disable", requireAdmin, async (c) => {
  const body = await readJson(c);
  return c.json(await c.get("container").adminAuth.disableTotp(c.get("adminId"), requireString(body, "code")));
});

adminRoutes.get("/me", requireAdmin, async (c) => {
  const admin = await c.get("container").adminAuth.getById(c.get("adminId"));
  return c.json({ admin });
});

// --- Payouts (§7.5) — Finance + Super Admin ---
const finance = [requireAdmin, requireRole("finance")] as const;

// Float / reserve monitor.
adminRoutes.get("/payouts/float", ...finance, async (c) => {
  return c.json(await c.get("container").payouts.floatSummary());
});

// Build a draft batch (reserves eligible balances).
adminRoutes.post("/payouts/batches", ...finance, async (c) => {
  const body = await readJson(c);
  const result = await c.get("container").payouts.buildBatch(c.get("adminId"), {
    minPayoutThresholdUgx: optionalInt(body, "minPayoutThresholdUgx"),
  });
  return c.json(result, 201);
});

adminRoutes.get("/payouts/batches", ...finance, async (c) => {
  return c.json({ batches: await c.get("container").payouts.listBatches() });
});

adminRoutes.get("/payouts/batches/:id", ...finance, async (c) => {
  return c.json(await c.get("container").payouts.getBatch(requireParam(c, "id")));
});

adminRoutes.post("/payouts/batches/:id/approve", ...finance, async (c) => {
  const batch = await c.get("container").payouts.approveBatch(c.get("adminId"), requireParam(c, "id"));
  return c.json({ batch });
});

adminRoutes.post("/payouts/batches/:id/execute", ...finance, async (c) => {
  const result = await c.get("container").payouts.executeBatch(c.get("adminId"), requireParam(c, "id"));
  return c.json(result);
});

// --- Moderation (§7.4) — Moderator + Super Admin ---
const mod = [requireAdmin, requireRole("moderator")] as const;

adminRoutes.get("/moderation/reports", ...mod, async (c) => {
  const status = c.req.query("status") as
    | "open" | "reviewing" | "actioned" | "dismissed" | undefined;
  return c.json({ reports: await c.get("container").moderation.listReports(status) });
});

adminRoutes.post("/moderation/reports/:id/resolve", ...mod, async (c) => {
  const body = await readJson(c);
  const outcome = requireString(body, "outcome");
  if (outcome !== "actioned" && outcome !== "dismissed") {
    throw badRequest("bad_outcome", "outcome must be 'actioned' or 'dismissed'");
  }
  const report = await c
    .get("container")
    .moderation.resolveReport(c.get("adminId"), requireParam(c, "id"), outcome);
  return c.json({ report });
});

// Content takedown: quarantine (reversible) / restore / remove (hard).
adminRoutes.post("/content/:id/quarantine", ...mod, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const content = await c
    .get("container")
    .moderation.quarantineContent(c.get("adminId"), requireParam(c, "id"), (body as Record<string, unknown>).reason as string | undefined);
  return c.json({ content });
});

adminRoutes.post("/content/:id/restore", ...mod, async (c) => {
  const content = await c.get("container").moderation.restoreContent(c.get("adminId"), requireParam(c, "id"));
  return c.json({ content });
});

adminRoutes.post("/content/:id/remove", ...mod, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const content = await c
    .get("container")
    .moderation.removeContent(c.get("adminId"), requireParam(c, "id"), (body as Record<string, unknown>).reason as string | undefined);
  return c.json({ content });
});

// Live kill-switch — end an abusive stream immediately (§7.4).
adminRoutes.post("/live/:id/kill", ...mod, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const live = await c
    .get("container")
    .moderation.killLive(c.get("adminId"), requireParam(c, "id"), (body as Record<string, unknown>).reason as string | undefined);
  return c.json({ live });
});

// --- Creator management (§7.3) — Moderator + Super Admin ---
// NOTE: /creators/lookup must be registered BEFORE /creators/:id, otherwise the
// param route swallows "lookup" as an id.
adminRoutes.get("/creators/lookup", ...mod, async (c) => {
  return c.json(await c.get("container").creatorAdmin.lookup(c.req.query("q") ?? ""));
});

adminRoutes.get("/creators/:id", ...mod, async (c) => {
  return c.json({ creator: await c.get("container").creatorAdmin.get(requireParam(c, "id")) });
});

adminRoutes.post("/creators/:id/suspend", ...mod, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const creator = await c
    .get("container")
    .creatorAdmin.suspend(c.get("adminId"), requireParam(c, "id"), (body as Record<string, unknown>).reason as string | undefined);
  return c.json({ creator });
});

adminRoutes.post("/creators/:id/ban", ...mod, async (c) => {
  const body = await readJson(c).catch(() => ({}));
  const creator = await c
    .get("container")
    .creatorAdmin.ban(c.get("adminId"), requireParam(c, "id"), (body as Record<string, unknown>).reason as string | undefined);
  return c.json({ creator });
});

adminRoutes.post("/creators/:id/reinstate", ...mod, async (c) => {
  const creator = await c.get("container").creatorAdmin.reinstate(c.get("adminId"), requireParam(c, "id"));
  return c.json({ creator });
});

adminRoutes.post("/creators/:id/verify", ...mod, async (c) => {
  const creator = await c.get("container").creatorAdmin.verify(c.get("adminId"), requireParam(c, "id"));
  return c.json({ creator });
});

// --- Config editor (§7.2) — reads: finance/analyst; writes: Super Admin only ---
adminRoutes.get("/config", requireAdmin, requireRole("finance", "analyst"), async (c) => {
  return c.json({ config: await c.get("container").configAdmin.listEffective() });
});

adminRoutes.get("/config/:key/history", requireAdmin, requireRole("finance", "analyst"), async (c) => {
  return c.json({ history: await c.get("container").configAdmin.history(requireParam(c, "key")) });
});

// A config change is a high-privilege action → Super Admin only.
adminRoutes.put("/config/:key", requireAdmin, requireRole(), async (c) => {
  const body = await readJson(c);
  if (!("value" in body)) throw badRequest("missing_field", '"value" is required');
  const updated = await c.get("container").configAdmin.setValue(
    c.get("adminId"),
    requireParam(c, "key"),
    body.value,
    optionalInt(body, "effectiveFrom"),
  );
  return c.json({ config: updated });
});

// --- Analytics (§7.7) — Finance + Analyst ---
const reports = [requireAdmin, requireRole("finance", "analyst")] as const;

function timeWindow(c: { req: { query: (k: string) => string | undefined } }) {
  const num = (v: string | undefined) => (v != null && v !== "" ? Number(v) : undefined);
  return { from: num(c.req.query("from")), to: num(c.req.query("to")) };
}

adminRoutes.get("/analytics/revenue", ...reports, async (c) => {
  const { from, to } = timeWindow(c);
  return c.json(await c.get("container").analytics.revenue(from, to));
});

adminRoutes.get("/analytics/top", ...reports, async (c) => {
  return c.json(await c.get("container").analytics.top());
});

adminRoutes.get("/analytics/self-funding", ...reports, async (c) => {
  const { from, to } = timeWindow(c);
  return c.json(await c.get("container").analytics.selfFunding(from, to));
});
