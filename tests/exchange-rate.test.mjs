import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./d1-fixture.mjs";
import { ConfigRepository } from "../src/repositories/config.repository.ts";
import { ExchangeRateService } from "../src/services/exchange-rate.service.ts";
import { ConfigAdminService } from "../src/services/admin/config-admin.service.ts";
import { AuditRepository } from "../src/repositories/audit.repository.ts";
import { POLICY_DEFAULTS } from "../src/services/live-price-policy.ts";

const now = () => Math.floor(Date.now() / 1000);
const payload = () => ({ result: "success", base_code: "USD", rates: { UGX: 3900 }, time_last_update_unix: now() - 60 });

test("daily FX fetch caches USD/UGX and avoids repeated successful requests", async t => {
  const ctx = fixture(); const fx = new ExchangeRateService(new ConfigRepository(ctx.db));
  let requests = 0;
  t.mock.method(globalThis, "fetch", async url => { requests++; assert.equal(url, "https://open.er-api.com/v6/latest/USD"); return Response.json(payload()); });
  assert.equal((await fx.current()).available, false);
  await fx.refresh(); await fx.refresh();
  assert.equal(requests, 1);
  const current = await fx.current(); assert.equal(current.rate, 3900); assert.equal(current.stale, false);
  assert.equal((await fx.approvalSnapshot(3900, true)).mode, "automatic");
  await assert.rejects(fx.approvalSnapshot(3800, true), { code: "fx_changed" });
});

test("invalid responses never establish a usable reference rate", async t => {
  const ctx = fixture(); const fx = new ExchangeRateService(new ConfigRepository(ctx.db));
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const body of [{ ...payload(), base_code: "EUR" }, { ...payload(), rates: { UGX: -1 } },
    { ...payload(), rates: { UGX: "3900" } }, { ...payload(), time_last_update_unix: now() + 3600 },
    { ...payload(), time_last_update_unix: now() - 4 * 86400 }, { result: "error" }]) {
    response = Response.json(body); await fx.refresh(); assert.equal((await fx.current()).available, false);
  }
  response = new Response("limited", { status: 429 }); await fx.refresh();
  assert.equal((await fx.current()).available, false);
});

test("outages retain the last rate, flag stale data and permit explicit manual override", async t => {
  const ctx = fixture(); const repo = new ConfigRepository(ctx.db); const fx = new ExchangeRateService(repo);
  await repo.append({ key: "USD_UGX_REFERENCE_RATE", valueJson: JSON.stringify({ rate: 3800, asOf: now() - 4 * 86400,
    fetchedAt: now() - 4 * 86400, source: "https://www.exchangerate-api.com" }), effectiveFrom: new Date(0), createdByAdminId: null });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network outage"); });
  await fx.refresh(); assert.equal((await fx.current()).rate, 3800); assert.equal((await fx.current()).stale, true);
  await assert.rejects(fx.approvalSnapshot(3800, true), { code: "fx_stale" });
  assert.deepEqual(await fx.approvalSnapshot(4000, false), { mode: "manual" });
});

test("approved policies snapshot FX provenance and refresh never changes approved prices", async t => {
  const ctx = fixture(); const repo = new ConfigRepository(ctx.db); const fx = new ExchangeRateService(repo);
  const admin = new ConfigAdminService(repo, new AuditRepository(ctx.db), {});
  t.mock.method(globalThis, "fetch", async () => Response.json(payload()));
  await fx.refresh();
  await admin.approveLivePricing("admin", { ...POLICY_DEFAULTS, usdToUgx: 3900 }, now() + 3600, true);
  const approved = (await repo.history("LIVE_COST_PRICE_POLICY"))[0];
  assert.equal(JSON.parse(approved.valueJson).fx.rate, 3900);
  assert.equal(JSON.parse(approved.valueJson).fx.mode, "automatic");
  assert.ok(ctx.sqlite.prepare("select detail_json from audit_log").get().detail_json.includes("exchangerate-api.com"));
  await fx.refresh();
  assert.equal((await repo.history("LIVE_COST_PRICE_POLICY"))[0].valueJson, approved.valueJson);
});
