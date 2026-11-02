import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel } from "miniflare";
import { createDb } from "../src/db/client.ts";
import { creators, content, users } from "../src/db/schema/index.ts";
import { sign } from "hono/jwt";

// Run after `wrangler deploy --dry-run --outdir .wrangler/build-check`.
// Ephemeral workerd/D1/R2 only; no local database, credentials, or providers.
const runtime = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("../.wrangler/build-check/index.js", import.meta.url)),
  modulesRules: [{ type: "Text", include: ["**/*.html"] }],
  compatibilityDate: "2025-07-01", compatibilityFlags: ["nodejs_compat"],
  log: new Log(LogLevel.ERROR),
  d1Databases: { DB: "isolated-smoke-db" }, r2Buckets: { MEDIA: "isolated-smoke-media" },
  durableObjects: { LIVE_ROOM: { className: "LiveRoom", useSQLite: true } },
  bindings: { ENVIRONMENT: "development", JWT_SECRET: "isolated-test-secret-only", PHONE_VERIFICATION_ENABLED: "1",
    LIVE_MIN_PRICE_PER_HOUR: "5000", RECORDED_PRICE_FLOOR: "5000", FLUTTERWAVE_FEE_PERCENT: "3",
    MIN_PAYOUT_THRESHOLD_UGX: "0", MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT: "0.5", LIVE_AUTO_TERMINATE_GRACE_MINUTES: "5" },
});

try {
  const d1 = await runtime.getD1Database("DB");
  const directory = new URL("../drizzle/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    const statements = readFileSync(new URL(name, directory), "utf8").split("--> statement-breakpoint").filter((sql) => sql.trim());
    await d1.batch(statements.map((sql) => d1.prepare(sql)));
  }
  const request = async (path, json, token) => {
    const response = await runtime.dispatchFetch(`http://localhost${path}`, {
      method: json ? "POST" : "GET",
      headers: { ...(json ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(json ? { body: JSON.stringify(json) } : {}),
    });
    const body = await response.json();
    assert.ok(response.ok, `${path}: HTTP ${response.status}, ${body.error ?? "unknown error"}`);
    return body;
  };
  assert.equal((await request("/health")).db, "up");
  const challenge = await request("/auth/otp/request", { phone: "0770123457" });
  const buyer = await request("/auth/signup", { phone: "0770123457", password: "smoke-password", code: challenge.devCode });
  const db = createDb(d1);
  const owner = await db.insert(users).values({ phone: "+256770123456", handle: "smoke-owner" }).returning().get();
  const creator = await db.insert(creators).values({ userId: owner.id }).returning().get();
  const item = await db.insert(content).values({ creatorId: creator.id, pricing: "paid", priceUgx: 5000, status: "published" }).returning().get();
  const first = await request("/payments/checkout", { type: "video_unlock", targetId: item.id }, buyer.token);
  const second = await request("/payments/checkout", { type: "video_unlock", targetId: item.id }, buyer.token);
  assert.equal(second.transactionId, first.transactionId);
  const payload = { event: "charge.completed", data: { tx_ref: first.txRef, status: "successful", amount: 5000, currency: "UGX" } };
  await Promise.all([request("/payments/webhook", payload), request("/payments/webhook", payload)]);
  assert.deepEqual(await request(`/payments/${first.transactionId}/status`, undefined, buyer.token), { status: "paid", owned: true });
  assert.equal((await d1.prepare("select balance_ugx from wallets").first()).balance_ugx, 3395);
  assert.equal((await d1.prepare("select count(*) as n from wallet_entries").first()).n, 1);
  const ownerToken = await sign({ sub: owner.id, typ: "user", exp: Math.floor(Date.now() / 1000) + 60 }, "isolated-test-secret-only");
  const scheduled = await request("/live", { declaredDurationMin: 60, ticketPriceUgx: 5000 }, ownerToken);
  const liveId = scheduled.live.id;
  await request(`/live/${liveId}/start`, {}, ownerToken);
  const noTicket = await runtime.dispatchFetch(`http://localhost/live/${liveId}/chat?token=${buyer.token}`, { headers: { upgrade: "websocket" } });
  assert.equal(noTicket.status, 403);
  const ticket = await request("/payments/checkout", { type: "live_ticket", targetId: liveId }, buyer.token);
  await request("/payments/webhook", { event: "charge.completed", data: { tx_ref: ticket.txRef, status: "successful", amount: 5000, currency: "UGX" } });
  const response = await runtime.dispatchFetch(`http://localhost/live/${liveId}/chat?token=${buyer.token}`, { headers: { upgrade: "websocket" } });
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  const closed = new Promise(resolve => ws.addEventListener("close", resolve, { once: true }));
  ws.accept();
  assert.equal((await request(`/live/${liveId}/chat/stats`)).viewers, 1);
  const duplicate = await runtime.dispatchFetch(`http://localhost/live/${liveId}/chat?token=${buyer.token}`, { headers: { upgrade: "websocket" } });
  duplicate.webSocket.accept();
  assert.equal((await request(`/live/${liveId}/chat/stats`)).viewers, 1);
  assert.equal((await closed).code, 4001);
  const ended = new Promise(resolve => duplicate.webSocket.addEventListener("close", resolve, { once: true }));
  await request(`/live/${liveId}/end`, {}, ownerToken);
  assert.equal((await ended).code, 4000);
  assert.equal((await request(`/live/${liveId}/chat/stats`)).viewers, 0);
  const stopped = await runtime.dispatchFetch(`http://localhost/live/${liveId}/chat?token=${buyer.token}`, { headers: { upgrade: "websocket" } });
  assert.equal(stopped.status, 403);
  await d1.prepare("update users set status = 'banned' where id = ?").bind(buyer.user.id).run();
  const disabled = await runtime.dispatchFetch("http://localhost/auth/me", { headers: { authorization: `Bearer ${buyer.token}` } });
  assert.equal(disabled.status, 401);
  console.log("Worker-runtime smoke passed: migrations, payments, account suspension, live ticket gating, duplicate socket replacement and terminal room closure.");
} finally {
  await runtime.dispose();
}
