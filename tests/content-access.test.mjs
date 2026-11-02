import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./d1-fixture.mjs";
import { users, creators, content, entitlements } from "../src/db/schema/index.ts";
import { ContentRepository } from "../src/repositories/content.repository.ts";
import { CreatorRepository } from "../src/repositories/creator.repository.ts";
import { EntitlementRepository } from "../src/repositories/entitlement.repository.ts";
import { SearchRepository } from "../src/repositories/search.repository.ts";
import { ContentService } from "../src/services/content.service.ts";
import { SearchService } from "../src/services/search.service.ts";
import { ConfigService } from "../src/services/config.service.ts";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { contentRoutes } from "../src/http/routes/content.routes.ts";
import { creatorRoutes } from "../src/http/routes/creators.routes.ts";
import { userRoutes } from "../src/http/routes/users.routes.ts";
import { searchRoutes } from "../src/http/routes/search.routes.ts";
import { UserRepository } from "../src/repositories/user.repository.ts";

async function setup() {
  const ctx = fixture();
  const owner = await ctx.db.insert(users).values({ phone: "+256770123456", handle: "owner" }).returning().get();
  const buyer = await ctx.db.insert(users).values({ phone: "+256770123457", handle: "buyer" }).returning().get();
  const creator = await ctx.db.insert(creators).values({ userId: owner.id }).returning().get();
  const repo = new ContentRepository(ctx.db);
  const storage = { reads: [], deletes: [], async get(key) { this.reads.push(key); return { key }; },
    async delete(key) { this.deletes.push(key); } };
  const config = new ConfigService(ctx.db, { RECORDED_PRICE_FLOOR: "5000", PHOTO_PRICE_FLOOR: "2000",
    LIVE_MIN_PRICE_PER_HOUR: "5000", FLUTTERWAVE_FEE_PERCENT: "3", FREE_CONTENT_MINUTES: "100", CLIP_MAX_LENGTH_SECONDS: "300" });
  const service = new ContentService(repo, new CreatorRepository(ctx.db), new EntitlementRepository(ctx.db), config, storage);
  const search = new SearchService(new SearchRepository(ctx.db), service);
  const item = await repo.create({ creatorId: creator.id, kind: "text", pricing: "paid", priceUgx: 5000,
    title: "confidential title", description: "confidential body", status: "published", publishedAt: new Date() });
  const grant = () => ctx.db.insert(entitlements).values({ userId: buyer.id, transactionId: "settled-sale", contentId: item.id }).run();
  return { ...ctx, owner, buyer, creator, repo, storage, service, search, item, grant };
}

test("all content discovery projections redact paid text; owner and buyer receive it", async () => {
  const s = await setup();
  const responses = [await s.service.getForViewer(s.item.id), await s.service.getCard(s.item.id),
    ...(await s.service.feed()), ...(await s.service.listPublishedByCreator(s.creator.id)),
    ...(await s.service.listPublishedByUser(s.owner.id))];
  for (const row of responses) {
    assert.equal(row.description, null); assert.equal(row.title, "Premium text");
    assert.equal(row.r2Key, null); assert.equal(row.owned, false);
  }
  assert.equal((await s.service.getCard(s.item.id, s.owner.id)).description, "confidential body");
  await s.grant();
  assert.equal((await s.service.getCard(s.item.id, s.buyer.id)).description, "confidential body");
  assert.equal((await s.service.feed(20, undefined, s.buyer.id))[0].owned, true);
});

test("public search cannot probe the body or auto-title of paid text", async () => {
  const s = await setup();
  assert.equal((await s.search.run("confidential")).posts.length, 0);
  await s.repo.update(s.item.id, { pricing: "free" });
  assert.equal((await s.search.run("confidential")).posts.length, 1);
});

test("clients cannot create cross-post storage references", async () => {
  const s = await setup();
  for (const field of ["r2Key", "thumbnailR2Key"]) {
    await assert.rejects(s.service.create(s.owner.id, { kind: "photo", [field]: "content/victim/media/object" }), { code: "storage_key_forbidden" });
  }
});

test("legacy foreign object references cannot be read or deleted", async () => {
  const s = await setup();
  await s.repo.update(s.item.id, { kind: "video", r2Key: "content/victim/media/object", thumbnailR2Key: "content/victim/thumb/object" });
  await assert.rejects(s.service.openMedia(s.item.id, s.owner.id), { status: 404 });
  await assert.rejects(s.service.openThumbnail(s.item.id), { status: 404 });
  await s.service.hardDelete(s.item.id, s.owner.id);
  assert.deepEqual(s.storage.reads, []); assert.deepEqual(s.storage.deletes, []);
});

test("paid photo thumbnails are never public, including legacy full-size covers", async () => {
  const s = await setup();
  await s.repo.update(s.item.id, { kind: "photo", thumbnailR2Key: `content/${s.item.id}/thumb/original` });
  await assert.rejects(s.service.openThumbnail(s.item.id), { status: 404 });
  assert.equal((await s.service.getCard(s.item.id)).thumbnailR2Key, null);
  assert.deepEqual(s.storage.reads, []);
});

test("archived purchases remain accessible, but drafts and quarantine remain private", async () => {
  const s = await setup(); await s.grant();
  await s.repo.update(s.item.id, { kind: "video", r2Key: `content/${s.item.id}/media/video`, status: "archived" });
  await s.service.openMedia(s.item.id, s.buyer.id);
  await s.service.getCard(s.item.id, s.buyer.id);
  await assert.rejects(s.service.getCard(s.item.id), { status: 403 });
  for (const status of ["draft", "quarantined"]) {
    await s.repo.update(s.item.id, { status });
    await assert.rejects(s.service.openMedia(s.item.id, s.buyer.id), { status: 403 });
    await assert.rejects(s.service.getCard(s.item.id), { status: 403 });
    await assert.rejects(s.service.openThumbnail(s.item.id), { status: 404 });
  }
});

test("quarantine cannot be undone by creator publication, archive, editing or uploads", async () => {
  const s = await setup(); await s.repo.update(s.item.id, { status: "quarantined" });
  for (const action of [() => s.service.publish(s.item.id, s.owner.id),
    () => s.service.unarchive(s.item.id, s.owner.id), () => s.service.archive(s.item.id, s.owner.id),
    () => s.service.update(s.item.id, s.owner.id, { title: "changed" }),
    () => s.service.attachMedia(s.item.id, s.owner.id, new ArrayBuffer(0))]) {
    await assert.rejects(action(), { status: 403 });
  }
  assert.equal((await s.repo.findById(s.item.id)).status, "quarantined");
});

test("database mutation guards reject a moderation change after the initial ownership check", async () => {
  const s = await setup();
  await s.repo.update(s.item.id, { status: "quarantined" });
  assert.equal(await s.repo.updateOwned(s.item.id, s.owner.id, { status: "published" }), undefined);
  await s.repo.update(s.item.id, { status: "draft" });
  s.sqlite.prepare("UPDATE creators SET status = 'suspended' WHERE id = ?").run(s.creator.id);
  assert.equal(await s.repo.updateOwned(s.item.id, s.owner.id, { status: "published" }), undefined);
  await assert.rejects(s.service.publish(s.item.id, s.owner.id), { status: 403 });
});

test("video and photo posts cannot be published without their own uploaded media", async () => {
  const s = await setup();
  await s.repo.update(s.item.id, { kind: "video", status: "draft" });
  await assert.rejects(s.service.publish(s.item.id, s.owner.id), { code: "media_required" });
});

test("HTTP discovery routes redact anonymous text and return uncached paid text only to its buyer", async () => {
  const s = await setup(); await s.grant();
  const app = new Hono();
  const env = { JWT_SECRET: "test-only-key" };
  app.use("*", async (c, next) => {
    c.set("container", { content: s.service, search: s.search, users: new UserRepository(s.db), creators: new CreatorRepository(s.db) });
    await next();
  });
  app.route("/content", contentRoutes); app.route("/creators", creatorRoutes);
  app.route("/users", userRoutes); app.route("/search", searchRoutes);
  const token = await sign({ sub: s.buyer.id, typ: "user", exp: Math.floor(Date.now() / 1000) + 60 }, env.JWT_SECRET);
  const paths = ["/content/feed", `/content/${s.item.id}`, `/content/${s.item.id}/card`,
    `/creators/${s.creator.id}/content`, `/users/${s.owner.id}/content`];
  for (const path of paths) {
    const anonymous = await app.request(path, {}, env);
    assert.equal(anonymous.status, 200, path);
    assert.equal((await anonymous.text()).includes("confidential"), false, path);
    const buyer = await app.request(path, { headers: { authorization: `Bearer ${token}` } }, env);
    assert.equal(buyer.status, 200, path);
    assert.match(buyer.headers.get("cache-control"), /no-store/);
    assert.equal((await buyer.text()).includes("confidential body"), true, path);
  }
  const profile = await app.request(`/creators/${s.creator.id}`, {}, env);
  const exposed = (await profile.json()).creator;
  assert.equal("payoutMsisdn" in exposed, false); assert.equal("kycStatus" in exposed, false);
});

test("photo and thumbnail upload validation runs before storage and preserves existing keys", async () => {
  const s = await setup();
  const photo = await s.repo.create({ creatorId: s.creator.id, kind: "photo", pricing: "free", status: "draft" });
  let writes = 0;
  s.storage.mediaKey = id => `content/${id}/media/new`;
  s.storage.thumbnailKey = id => `content/${id}/thumb/new`;
  s.storage.put = async (key, body) => { writes++; return { key, size: body.byteLength }; };
  await assert.rejects(s.service.attachMedia(photo.id, s.owner.id, new TextEncoder().encode("html").buffer, "image/jpeg"), { code: "invalid_image" });
  await assert.rejects(s.service.attachThumbnail(photo.id, s.owner.id, new ArrayBuffer(2 * 1048576 + 1), "image/jpeg"), { status: 413 });
  await assert.rejects(s.service.attachMedia(photo.id, s.owner.id, new ArrayBuffer(8 * 1048576 + 1), "image/jpeg"), { status: 413 });
  assert.equal(writes, 0); assert.equal((await s.repo.findById(photo.id)).r2Key, null);
  const uploaded = await s.service.attachMedia(photo.id, s.owner.id, Uint8Array.from([255, 216, 255, 224]).buffer, "image/jpeg");
  assert.equal(writes, 1); assert.equal(uploaded.sizeBytes, 4);
  assert.equal(uploaded.r2Key, `content/${photo.id}/media/new`);
  await assert.rejects(s.service.attachMedia(s.item.id, s.owner.id, new ArrayBuffer(0), "video/mp4"), { code: "text_media" });
});
