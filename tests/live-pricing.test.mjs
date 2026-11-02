import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./d1-fixture.mjs";
import { POLICY_DEFAULTS, quotePolicy, validatePolicy } from "../src/services/live-price-policy.ts";
import { ConfigRepository } from "../src/repositories/config.repository.ts";
import { AuditRepository } from "../src/repositories/audit.repository.ts";
import { ConfigAdminService } from "../src/services/admin/config-admin.service.ts";
import { ConfigService } from "../src/services/config.service.ts";
import { LiveService } from "../src/services/live.service.ts";
import { LiveRepository } from "../src/repositories/live.repository.ts";
import { CreatorRepository } from "../src/repositories/creator.repository.ts";
import { users, creators } from "../src/db/schema/index.ts";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { adminRoutes } from "../src/http/routes/admin.routes.ts";

const env = { LIVE_MIN_PRICE_PER_HOUR: "5000", RECORDED_PRICE_FLOOR: "5000", FLUTTERWAVE_FEE_PERCENT: "3", LIVE_AUTO_TERMINATE_GRACE_MINUTES: "5" };

test("cost floor covers the platform budget after fees and creator share", () => {
  const p = validatePolicy(POLICY_DEFAULTS), q = quotePolicy(p, 60);
  assert.equal(q.billedMinutes, 65);
  assert.ok(q.floor * (1 - p.collectionPercent / 100) * (1 - p.creatorPercent / 100) >= q.budgetUgx);
  assert.ok(quotePolicy({ ...p, usdToUgx: p.usdToUgx * 2 }, 60).floor > q.floor);
  assert.ok(quotePolicy(p, 60, 90).floor > q.floor);
  assert.equal(quotePolicy(p, 1).floor, quotePolicy(p, 30).floor);
  assert.ok(quotePolicy(p, 31).floor > quotePolicy(p, 30).floor);
  for (const blockMinutes of [15, 30, 60]) {
    const policy = { ...p, blockMinutes };
    assert.equal(quotePolicy(policy, 1).floor, quotePolicy(policy, blockMinutes).floor);
    assert.ok(quotePolicy(policy, blockMinutes + 1).floor > quotePolicy(policy, blockMinutes).floor);
  }
  for (const patch of [{ usdToUgx: 0 }, { collectionPercent: 100 }, { creatorPercent: 60 }, { blockMinutes: 0 }, { bitrateMbps: NaN }, { roundingUgx: 0 }]) {
    assert.throws(() => validatePolicy({ ...p, ...patch }), { code: "invalid_policy" });
  }
});

test("approval is atomic, future-dated and preserves existing event prices", async () => {
  const ctx = fixture(); const repo = new ConfigRepository(ctx.db);
  const admin = new ConfigAdminService(repo, new AuditRepository(ctx.db), env);
  const config = new ConfigService(ctx.db, env);
  const owner = await ctx.db.insert(users).values({ phone: "+256770123456", handle: "owner" }).returning().get();
  await ctx.db.insert(creators).values({ userId: owner.id, status: "active" });
  const service = new LiveService(new LiveRepository(ctx.db), new CreatorRepository(ctx.db), config, null, null, null);
  const before = await service.schedule(owner.id, { declaredDurationMin: 30, ticketPriceUgx: 5000 });
  const future = Math.floor(Date.now() / 1000) + 3600;
  ctx.adapter.failAt = 1;
  await assert.rejects(admin.approveLivePricing("admin", POLICY_DEFAULTS, future));
  assert.equal((await repo.history("LIVE_COST_PRICE_POLICY")).length, 0);
  ctx.adapter.failAt = null;
  await admin.approveLivePricing("admin", POLICY_DEFAULTS, future);
  assert.equal((await service.quoteFloor(30)).floor, 5000);
  ctx.sqlite.exec("update platform_config set effective_from = 0 where key = 'LIVE_COST_PRICE_POLICY'");
  const floor = (await service.quoteFloor(30)).floor;
  assert.equal(floor, quotePolicy(POLICY_DEFAULTS, 30).floor);
  await assert.rejects(service.schedule(owner.id, { declaredDurationMin: 30, ticketPriceUgx: floor - 1 }), { code: "below_live_price_floor" });
  const created = await service.schedule(owner.id, { declaredDurationMin: 30, ticketPriceUgx: floor });
  assert.equal(created.priceFloorAppliedUgx, floor);
  assert.equal((await new LiveRepository(ctx.db).findById(before.id)).ticketPriceUgx, 5000);
  assert.equal((await new LiveRepository(ctx.db).findById(before.id)).priceFloorAppliedUgx, 5000);
  await repo.append({ key: "FLUTTERWAVE_FEE_PERCENT", valueJson: "10", effectiveFrom: new Date(0), createdByAdminId: "admin" });
  await repo.append({ key: "LIVE_AUTO_TERMINATE_GRACE_MINUTES", valueJson: "20", effectiveFrom: new Date(0), createdByAdminId: "admin" });
  assert.ok((await service.quoteFloor(30)).floor > floor);
  ctx.sqlite.exec("update creators set live_split_bps_override = 9000");
  await assert.rejects(service.schedule(owner.id, { declaredDurationMin: 30, ticketPriceUgx: floor }), { code: "below_live_price_floor" });
});

test("finance can preview but only Super Admin can approve pricing", async () => {
  const ctx = fixture(); let role = "finance";
  const configAdmin = new ConfigAdminService(new ConfigRepository(ctx.db), new AuditRepository(ctx.db), env);
  const app = new Hono(); const runtime = { JWT_SECRET: "test-pricing-secret" };
  app.use("*", async (c, next) => { c.set("container", { configAdmin, adminAuth: { getById: async () => ({ status: "active", role }) } }); await next(); });
  app.route("/admin", adminRoutes); app.onError((e,c) => c.json({ code: e.code }, e.status || 500));
  const token = await sign({ sub: "admin", typ: "admin" }, runtime.JWT_SECRET);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const body = JSON.stringify({ policy: POLICY_DEFAULTS, durationMinutes: 60, effectiveFrom: Math.floor(Date.now()/1000) + 3600 });
  assert.equal((await app.request("/admin/pricing/live/approve", { method: "POST", body }, runtime)).status, 401);
  assert.equal((await app.request("/admin/pricing/live/preview", { method: "POST", headers, body }, runtime)).status, 200);
  assert.equal((await app.request("/admin/pricing/live/approve", { method: "POST", headers, body }, runtime)).status, 403);
  role = "super_admin";
  assert.equal((await app.request("/admin/pricing/live/approve", { method: "POST", headers, body }, runtime)).status, 200);
  assert.equal(ctx.sqlite.prepare("select count(*) as n from audit_log where action = 'pricing.policy.approve'").get().n, 1);
});
