import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { fixture } from "./d1-fixture.mjs";
import { users, creators, liveEvents, entitlements } from "../src/db/schema/index.ts";
import { LiveRepository } from "../src/repositories/live.repository.ts";
import { CreatorRepository } from "../src/repositories/creator.repository.ts";
import { UserRepository } from "../src/repositories/user.repository.ts";
import { EntitlementRepository } from "../src/repositories/entitlement.repository.ts";
import { ConfigService } from "../src/services/config.service.ts";
import { LiveService } from "../src/services/live.service.ts";
import { LiveShutdownService } from "../src/services/live-shutdown.service.ts";
import { closeLiveKitRoom, mintLiveKitToken } from "../src/services/livekit.ts";
import { LiveRoom, uniqueViewerCount } from "../src/realtime/live-room.ts";
import { liveRoutes } from "../src/http/routes/live.routes.ts";
import { terminateOverrunLives } from "../src/jobs/terminate-overrun-lives.ts";
import { ModerationService } from "../src/services/admin/moderation.service.ts";

async function setup() {
  const ctx = fixture(); const calls = [];
  const owner = await ctx.db.insert(users).values({ phone: "+256770123456", handle: "owner" }).returning().get();
  const buyer = await ctx.db.insert(users).values({ phone: "+256770123457", handle: "buyer" }).returning().get();
  const creator = await ctx.db.insert(creators).values({ userId: owner.id }).returning().get();
  const event = await ctx.db.insert(liveEvents).values({ creatorId: creator.id, declaredDurationMin: 60,
    ticketPriceUgx: 5000, priceFloorAppliedUgx: 5000, status: "live", startedAt: new Date() }).returning().get();
  const env = { DB: ctx.adapter, ENVIRONMENT: "development", JWT_SECRET: "isolated-live-test-key",
    LIVE_AUTO_TERMINATE_GRACE_MINUTES: "5", LIVE_ROOM: { idFromName: id => id,
      get: id => ({ fetch: async (url, init) => { calls.push({ id, url, init }); return Response.json({ ok: true }); } }) } };
  const repo = new LiveRepository(ctx.db); const creatorRepo = new CreatorRepository(ctx.db);
  const userRepo = new UserRepository(ctx.db);
  const shutdown = new LiveShutdownService(repo, creatorRepo, env);
  const service = new LiveService(repo, creatorRepo, new ConfigService(ctx.db, env), new EntitlementRepository(ctx.db), userRepo, shutdown);
  const grant = () => ctx.db.insert(entitlements).values({ userId: buyer.id, transactionId: "paid-live", liveEventId: event.id }).run();
  return { ...ctx, owner, buyer, creator, event, env, calls, repo, userRepo, service, shutdown, grant };
}

test("live admission requires a ticket, active accounts, live status and an unexpired duration", async () => {
  const s = await setup();
  await assert.rejects(s.service.requireAccess(s.event.id, s.buyer.id), { status: 403 });
  assert.equal((await s.service.requireAccess(s.event.id, s.owner.id)).isOwner, true);
  await s.grant(); assert.equal((await s.service.requireAccess(s.event.id, s.buyer.id)).owned, true);
  s.sqlite.prepare("UPDATE creators SET status = 'suspended'").run();
  await assert.rejects(s.service.requireAccess(s.event.id, s.buyer.id), { status: 403 });
  s.sqlite.prepare("UPDATE creators SET status = 'active'").run();
  s.sqlite.prepare("UPDATE live_events SET started_at = ?").run(Math.floor(Date.now() / 1000) - 4000);
  await assert.rejects(s.service.requireAccess(s.event.id, s.buyer.id), { status: 403 });
});

test("ending a live closes chat and persists a retry when external closure fails", async () => {
  const s = await setup();
  s.env.LIVE_ROOM.get = () => ({ fetch: async () => { throw new Error("outage"); } });
  const ended = await s.service.end(s.event.id, s.owner.id);
  assert.equal(ended.status, "ended"); assert.equal(ended.shutdownPending, true);
  assert.equal((await s.repo.pendingShutdowns()).length, 1);
  s.env.LIVE_ROOM.get = () => ({ fetch: async () => Response.json({ closed: true }) });
  await s.shutdown.retryPending();
  assert.equal((await s.repo.findById(s.event.id)).shutdownPending, false);
  await assert.rejects(s.service.requireAccess(s.event.id, s.owner.id), { status: 403 });
});

test("atomic start cannot resurrect a killed live or start a suspended creator's event", async () => {
  const s = await setup(); await s.repo.finish(s.event.id, "terminated");
  assert.equal(await s.repo.startOwned(s.event.id, s.owner.id), undefined);
  s.sqlite.prepare("UPDATE live_events SET status = 'scheduled'").run();
  s.sqlite.prepare("UPDATE creators SET status = 'suspended'").run();
  assert.equal(await s.repo.startOwned(s.event.id, s.owner.id), undefined);
});

test("cron completes normal overruns and processes pending shutdowns", async () => {
  const s = await setup();
  s.sqlite.prepare("UPDATE live_events SET started_at = ?").run(Math.floor(Date.now() / 1000) - 4000);
  assert.equal((await terminateOverrunLives(s.env)).terminated, 1);
  assert.equal((await s.repo.findById(s.event.id)).status, "ended");
  assert.ok(s.calls.some(c => c.url.endsWith("/close")));
});

test("provider closure revokes publishing and deletes the room; transient failures are not success", async t => {
  const calls = [];
  const env = { LIVEKIT_URL: "wss://test.livekit.cloud", LIVEKIT_API_KEY: "test-key", LIVEKIT_API_SECRET: "test-secret" };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const grant = await verify(init.headers.authorization.slice(7), env.LIVEKIT_API_SECRET, "HS256");
    assert.equal(grant.video.roomAdmin, true); assert.equal(grant.video.roomCreate, true);
    calls.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({});
  });
  const startedAtSeconds = Math.floor(Date.now() / 1000);
  await closeLiveKitRoom(env, "event", "owner");
  assert.equal(calls[0].body.identity, "owner");
  assert.ok(calls[0].body.revoke_token_ts > startedAtSeconds);
  assert.equal(calls[1].url, "https://test.livekit.cloud/twirp/livekit.RoomService/DeleteRoom");
  globalThis.fetch.mock.mockImplementation(async url => String(url).endsWith("RemoveParticipant")
    ? Response.json({ code: "unavailable" }, { status: 503 }) : Response.json({}));
  await assert.rejects(closeLiveKitRoom(env, "event", "owner"), { code: "live_shutdown_pending" });
});

test("live admission grants are short-lived and viewers cannot publish", async () => {
  const token = await mintLiveKitToken({ apiKey: "test-key", apiSecret: "test-secret", identity: "buyer",
    grant: { room: "event", canPublish: false, canSubscribe: true } });
  const claims = await verify(token, "test-secret", "HS256");
  assert.equal(claims.exp - claims.nbf, 60); assert.equal(claims.video.canPublish, false);
});

test("viewer counts deduplicate paid identities and exclude the broadcaster and closed sockets", () => {
  const socket = (userId, isViewer, readyState = 1) => ({ readyState, deserializeAttachment: () => ({ userId, isViewer }) });
  assert.equal(uniqueViewerCount([socket("buyer", true), socket("buyer", true), socket("owner", false), socket("gone", true, 3)]), 1);
});

test("DO closure persists through hibernation and stops messages and presence", async () => {
  const stored = new Map(); const sent = []; const closed = [];
  const ws = { readyState: 1, send: data => sent.push(JSON.parse(data)), close: code => closed.push(code),
    deserializeAttachment: () => ({ userId: "buyer", isViewer: true }) };
  const state = { storage: { get: async key => stored.get(key), put: async (key, value) => stored.set(key, value) }, getWebSockets: () => [ws] };
  const room = new LiveRoom(state, {});
  assert.equal((await room.fetch(new Request("https://room/close", { method: "POST" }))).status, 200);
  assert.equal(sent[0].type, "ended"); assert.equal(closed[0], 4000);
  const resumed = new LiveRoom(state, {});
  await resumed.webSocketMessage(ws, JSON.stringify({ type: "chat", body: "must not broadcast" }));
  assert.equal(sent.length, 1);
  assert.equal((await (await resumed.fetch(new Request("https://room/stats"))).json()).viewers, 0);
});

test("HTTP chat refuses an unticketed account before contacting the Durable Object", async () => {
  const s = await setup(); const app = new Hono();
  app.use("*", async (c, next) => { c.set("container", { live: s.service, users: s.userRepo }); await next(); });
  app.onError((err, c) => c.json({ error: err.code }, err.status ?? 500)); app.route("/live", liveRoutes);
  const token = await sign({ sub: s.buyer.id, typ: "user", exp: Math.floor(Date.now() / 1000) + 60 }, s.env.JWT_SECRET);
  const url = `/live/${s.event.id}/chat?token=${token}`;
  assert.equal((await app.request(url, { headers: { upgrade: "websocket" } }, s.env)).status, 403);
  assert.equal(s.calls.length, 0);
  await s.grant();
  assert.equal((await app.request(url, { headers: { upgrade: "websocket" } }, s.env)).status, 200);
  assert.equal(s.calls.length, 1);
});

test("moderator kill closes transports and repeated kills cannot restart or reset the event", async () => {
  const s = await setup(); const audit = [];
  const moderation = new ModerationService(null, null, null, s.repo, { record: async entry => audit.push(entry) }, s.shutdown);
  const first = await moderation.killLive("admin", s.event.id, "moderation");
  const second = await moderation.killLive("admin", s.event.id, "retry");
  assert.equal(first.status, "terminated"); assert.equal(second.status, "terminated");
  assert.equal(first.endedAt.getTime(), second.endedAt.getTime());
  assert.ok(s.calls.every(c => c.url.endsWith("/close")));
  assert.equal(audit.length, 2);
});

test("chat caps oversized frames and limits message bursts", async t => {
  t.mock.method(Date, "now", () => 10000);
  const stored = new Map(); const sent = []; const closed = [];
  let attachment = { userId: "buyer", handle: "buyer", isViewer: true, accessCheckedAt: 10000 };
  const ws = { readyState: 1, send: data => sent.push(JSON.parse(data)), close: code => closed.push(code),
    deserializeAttachment: () => attachment, serializeAttachment: value => { attachment = value; } };
  const state = { storage: { get: async key => stored.get(key), put: async (key, value) => stored.set(key, value) }, getWebSockets: () => [ws] };
  const room = new LiveRoom(state, {});
  for (let i = 0; i < 15; i++) await room.webSocketMessage(ws, JSON.stringify({ type: "chat", body: "hello" }));
  assert.equal(sent.length, 10); assert.equal(stored.get("history").length, 10);
  await room.webSocketMessage(ws, "x".repeat(4097)); assert.equal(closed.at(-1), 1009);
});
