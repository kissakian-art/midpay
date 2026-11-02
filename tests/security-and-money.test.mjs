import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { fixture } from "./d1-fixture.mjs";
import { users, creators, content, liveEvents, wallets } from "../src/db/schema/index.ts";
import { UserRepository } from "../src/repositories/user.repository.ts";
import { OtpRepository } from "../src/repositories/otp.repository.ts";
import { TransactionRepository } from "../src/repositories/transaction.repository.ts";
import { EntitlementRepository } from "../src/repositories/entitlement.repository.ts";
import { ContentRepository } from "../src/repositories/content.repository.ts";
import { CreatorRepository } from "../src/repositories/creator.repository.ts";
import { LiveRepository } from "../src/repositories/live.repository.ts";
import { WalletRepository } from "../src/repositories/wallet.repository.ts";
import { PayoutRepository } from "../src/repositories/payout.repository.ts";
import { AuditRepository } from "../src/repositories/audit.repository.ts";
import { AdminRepository } from "../src/repositories/admin.repository.ts";
import { FinancialRepository } from "../src/repositories/financial.repository.ts";
import { AuthRateLimitRepository } from "../src/repositories/auth-rate-limit.repository.ts";
import { AuthService } from "../src/services/auth.service.ts";
import { ConfigService } from "../src/services/config.service.ts";
import { AdminAuthService } from "../src/services/admin/admin-auth.service.ts";
import { PaymentsService } from "../src/services/payments/payments.service.ts";
import { FlutterwaveClient } from "../src/services/payments/flutterwave.ts";
import { PayoutService } from "../src/services/payout.service.ts";
import { hashPassword } from "../src/services/crypto.ts";
import { getOptionalUserId, requireAuth } from "../src/http/middleware/auth.ts";
import { requireAdmin } from "../src/http/middleware/admin-auth.ts";
import { authRateLimit } from "../src/http/middleware/auth-rate-limit.ts";
import { CreatorAnalyticsService } from '../src/services/creator-analytics.service.ts';
import { liveViewerCount } from '../src/services/livekit.ts';

const baseEnv = { ENVIRONMENT: "development", JWT_SECRET: "test-secret-only", PHONE_VERIFICATION_ENABLED: "1",
  LIVE_AUTO_TERMINATE_GRACE_MINUTES: "5",
  LIVE_MIN_PRICE_PER_HOUR: "5000", RECORDED_PRICE_FLOOR: "5000", FLUTTERWAVE_FEE_PERCENT: "3",
  MIN_PAYOUT_THRESHOLD_UGX: "0", MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT: "0.5" };

function services(context, overrides = {}) {
  const env = { ...baseEnv, ...overrides };
  const { db } = context;
  const userRepo = new UserRepository(db);
  const creatorRepo = new CreatorRepository(db);
  const config = new ConfigService(db, env);
  const financial = new FinancialRepository(db);
  const flw = new FlutterwaveClient(env);
  const txRepo = new TransactionRepository(db);
  const walletRepo = new WalletRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const audit = new AuditRepository(db);
  return { env, userRepo, config, financial, flw, txRepo, walletRepo, payoutRepo,
    auth: new AuthService(userRepo, new OtpRepository(db), config, env),
    payments: new PaymentsService(userRepo, creatorRepo, new ContentRepository(db), new LiveRepository(db), txRepo,
      new EntitlementRepository(db), financial, config, flw, audit),
    payouts: new PayoutService(payoutRepo, walletRepo, creatorRepo, userRepo, config, flw, audit, financial, env),
    adminAuth: new AdminAuthService(new AdminRepository(db), audit, env) };
}

async function seed(context) {
  const creatorUser = await context.db.insert(users).values({ phone: "+256770123456", handle: "creator", phoneVerifiedAt: new Date() }).returning().get();
  const buyer = await context.db.insert(users).values({ phone: "+256770123457", handle: "buyer" }).returning().get();
  const creator = await context.db.insert(creators).values({ userId: creatorUser.id, status: "active", payoutProvider: "mtn" }).returning().get();
  const item = await context.db.insert(content).values({ creatorId: creator.id, pricing: "paid", priceUgx: 5000, status: "published", kind: "video" }).returning().get();
  return { creatorUser, buyer, creator, item };
}

const scalar = (context, query) => Object.values(context.sqlite.prepare(query).get())[0];
const webhook = (purchase) => ({ event: "charge.completed", data: { tx_ref: purchase.txRef, status: "successful", amount: 5000, currency: "UGX" } });

async function withdrawalSetup(overrides = {}) {
  const context = fixture();
  const s = services(context, { SELF_SERVICE_WITHDRAWALS_ENABLED: '1', MIN_PAYOUT_THRESHOLD_UGX: '1000', WITHDRAWAL_FIXED_FEE_UGX: '100', ...overrides });
  const seeded = await seed(context);
  await context.db.insert(wallets).values({ creatorId: seeded.creator.id, balanceUgx: 10000, lifetimeEarnedUgx: 10000 });
  return { context, s, ...seeded };
}

test('creator withdrawal pays a chosen amount once and retains the remaining balance', async () => {
  const { context, s, creatorUser, creator } = await withdrawalSetup();
  const quote = await s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'mtn');
  assert.equal(quote.feeUgx, 120); assert.equal(quote.netUgx, 3880);
  const result = await s.payouts.requestWithdrawal(creatorUser.id, quote);
  assert.equal(result.status, 'sent');
  assert.deepEqual(await s.payouts.requestWithdrawal(creatorUser.id, quote), result);
  assert.equal((await s.walletRepo.findByCreatorId(creator.id)).balanceUgx, 6000);
  assert.equal(scalar(context, 'select count(*) from payouts'), 1);
  await assert.rejects(s.payouts.requestWithdrawal(creatorUser.id, { ...quote, amountUgx: 5000 }), { code: 'request_reused' });
});

test('withdrawals enforce activation, minimum, amount, network and quoted fee', async () => {
  const { s, creatorUser } = await withdrawalSetup();
  for (const amount of [0, 999, 10001, 1.5, NaN]) await assert.rejects(s.payouts.quoteWithdrawal(creatorUser.id, amount, 'mtn'), { code: 'invalid_amount' });
  await assert.rejects(s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'other'), { code: 'invalid_network' });
  const quote = await s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'mtn');
  await assert.rejects(s.payouts.requestWithdrawal(creatorUser.id, { ...quote, feeUgx: 0 }), { code: 'fee_changed' });
  const disabled = await withdrawalSetup({ SELF_SERVICE_WITHDRAWALS_ENABLED: '0' });
  await assert.rejects(disabled.s.payouts.quoteWithdrawal(disabled.creatorUser.id, 4000, 'mtn'), { code: 'withdrawals_disabled' });
  const noMinimum = await withdrawalSetup({ MIN_PAYOUT_THRESHOLD_UGX: '0' });
  await assert.rejects(noMinimum.s.payouts.quoteWithdrawal(noMinimum.creatorUser.id, 4000, 'mtn'), { code: 'withdrawals_unconfigured' });
});

test('unknown creator transfer retains a hold and retries never submit twice', async () => {
  const { s, creatorUser, creator } = await withdrawalSetup();
  let sends = 0;
  s.flw.initiateTransfer = async () => { sends++; throw new Error('timeout'); };
  s.flw.verifyTransfer = async () => ({ status: 'pending', simulated: false });
  const quote = await s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'mtn');
  assert.equal((await s.payouts.requestWithdrawal(creatorUser.id, quote)).status, 'held');
  await s.payouts.requestWithdrawal(creatorUser.id, quote);
  await s.payouts.resumeCreatorWithdrawals();
  assert.equal(sends, 1);
  assert.equal((await s.walletRepo.findByCreatorId(creator.id)).heldUgx, 4000);
  const another = await s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'airtel');
  await assert.rejects(s.payouts.requestWithdrawal(creatorUser.id, another), { code: 'withdrawal_processing' });
});

test('provider funding failure does not reserve creator money', async () => {
  const { s, creatorUser, creator } = await withdrawalSetup();
  s.flw.availablePayoutBalanceUgx = async () => 0;
  const quote = await s.payouts.quoteWithdrawal(creatorUser.id, 4000, 'mtn');
  await assert.rejects(s.payouts.requestWithdrawal(creatorUser.id, quote), { code: 'payout_funding' });
  assert.equal((await s.walletRepo.findByCreatorId(creator.id)).balanceUgx, 10000);
  assert.equal((await s.walletRepo.findByCreatorId(creator.id)).heldUgx, 0);
});

test('live earnings are locked until completion and statement uses paid transaction snapshots', async () => {
  const { context, s, creatorUser, creator, buyer } = await withdrawalSetup();
  const event = await context.db.insert(liveEvents).values({ creatorId: creator.id, declaredDurationMin: 30, ticketPriceUgx: 5000, priceFloorAppliedUgx: 5000, creatorSplitBps: 6000 }).returning().get();
  const tx = await s.txRepo.create({ type: 'live_ticket', buyerId: buyer.id, creatorId: creator.id, liveEventId: event.id,
    grossUgx: 5000, flutterwaveFeeUgx: 150, netPoolUgx: 4850, creatorShareUgx: 2910, platformShareUgx: 1940, creatorSplitBps: 6000 });
  await s.financial.settle(tx.id);
  const overview = await s.payouts.withdrawalOverview(creatorUser.id);
  assert.equal(overview.pendingLiveUgx, 2910); assert.equal(overview.eligibleUgx, 10000);
  await assert.rejects(s.payouts.quoteWithdrawal(creatorUser.id, 11000, 'mtn'), { code: 'invalid_amount' });
  const analytics = new CreatorAnalyticsService(new CreatorRepository(context.db), s.txRepo, s.walletRepo, new ContentRepository(context.db), new LiveRepository(context.db));
  const statement = await analytics.liveStatement(creatorUser.id, event.id);
  assert.deepEqual(statement.totals, { tickets: 1, grossUgx: 5000, feesUgx: 150, netUgx: 4850, creatorUgx: 2910, platformUgx: 1940 });
  await assert.rejects(analytics.liveStatement(buyer.id, event.id), { code: 'not_found' });
  context.sqlite.prepare("update live_events set status='ended' where id=?").run(event.id);
  assert.equal((await s.payouts.withdrawalOverview(creatorUser.id)).eligibleUgx, 12910);
});

test('video viewer count excludes host, disconnected participants and agents, and deduplicates identities', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ participants: [
    { identity: 'host', state: 'ACTIVE' }, { identity: 'a', state: 'ACTIVE' }, { identity: 'a', state: 2 },
    { identity: 'b', state: 'DISCONNECTED' }, { identity: 'bot', state: 2, kind: 'AGENT' },
  ] }));
  assert.equal(await liveViewerCount({ LIVEKIT_URL: 'wss://video.example', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-only' }, 'room', 'host'), 1);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({}, { status: 503 }));
  await assert.rejects(liveViewerCount({ LIVEKIT_URL: 'wss://video.example', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-only' }, 'room', 'host'));
});

test('provider balance check fails closed on missing currency and malformed amounts', async t => {
  const client = new FlutterwaveClient({ ENVIRONMENT: 'production', FLW_SECRET_KEY: 'test-only', FLW_WEBHOOK_HASH: 'test-only' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', data: [{ currency: 'UGX', available_balance: 50000 }] }));
  assert.equal(await client.availablePayoutBalanceUgx(), 50000);
  for (const data of [[], [{ currency: 'USD', available_balance: 10 }], [{ currency: 'UGX', available_balance: '50000' }]]) {
    globalThis.fetch.mock.mockImplementation(async () => Response.json({ status: 'success', data }));
    await assert.rejects(client.availablePayoutBalanceUgx(), { code: 'payout_balance_unavailable' });
  }
});

test("legacy signup cannot set a password without phone proof", async () => {
  const context = fixture(); const s = services(context); const { buyer } = await seed(context);
  await assert.rejects(s.auth.signup(buyer.phone, "new-password"), { code: "verification_required" });
  assert.equal((await s.userRepo.findById(buyer.id)).passwordHash, null);
  const challenge = await s.auth.requestOtp(buyer.phone);
  const result = await s.auth.signup(buyer.phone, "new-password", challenge.devCode);
  assert.equal(result.user.id, buyer.id);
  assert.ok(result.user.passwordHash);
  await assert.rejects(s.auth.verifyOtp(buyer.phone, challenge.devCode), { code: "otp_not_found" });
});

test("development bypass cannot authenticate or claim an existing account", async () => {
  const context = fixture(); const s = services(context, { PHONE_VERIFICATION_ENABLED: "0" }); const { buyer } = await seed(context);
  await assert.rejects(s.auth.signup(buyer.phone, "new-password"), { code: "verification_required" });
  await assert.rejects(s.auth.verifyOtp(buyer.phone, "anything"), { code: "otp_disabled" });
  assert.ok((await s.auth.requestOtp(buyer.phone)).devCode);
  const result = await s.auth.signup("0770123458", "new-password");
  assert.equal(result.user.phoneVerifiedAt, null);
});

test("unconfigured production SMS blocks signup and OTP; password login works", async () => {
  const context = fixture(); const s = services(context, { ENVIRONMENT: "production", PHONE_VERIFICATION_ENABLED: "0" });
  await assert.rejects(s.auth.signup("0770123456", "new-password"), { code: "sms_unconfigured" });
  await assert.rejects(s.auth.requestOtp("0770123456"), { code: "sms_unconfigured" });
  await assert.rejects(s.auth.verifyOtp("0770123456", "123456"), { code: "sms_unconfigured" });
  assert.equal(await s.config.phoneVerificationEnabled(), true);
  const user = await context.db.insert(users).values({ phone: "+256770123456", handle: "login", passwordHash: await hashPassword("test-password") }).returning().get();
  assert.equal((await s.auth.loginWithPassword(user.phone, "test-password")).user.id, user.id);
});

test("invalid phone numbers cannot be registered", async () => {
  const s = services(fixture());
  await assert.rejects(s.auth.signup("attacker", "new-password"), { code: "invalid_phone" });
});

test("OTP attempts increment atomically and a challenge can be consumed once", async () => {
  const context = fixture(); const repo = new OtpRepository(context.db);
  const challenge = await repo.create({ phone: "+256770123456", codeHash: "hash", expiresAt: new Date(Date.now() + 300000) });
  await Promise.all([repo.incrementAttempts(challenge.id), repo.incrementAttempts(challenge.id)]);
  assert.equal(scalar(context, "select attempts from otp_challenges"), 2);
  const results = await Promise.all([repo.consume(challenge.id, new Date(), 5), repo.consume(challenge.id, new Date(), 5)]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("production and unknown environments never simulate payments or accept unsigned webhooks", async () => {
  for (const ENVIRONMENT of ["production", "staging", undefined]) {
    const flw = new FlutterwaveClient({ ...baseEnv, ENVIRONMENT });
    assert.equal(flw.verifyWebhook(undefined), false);
    await assert.rejects(flw.initiateMobileMoneyCharge({ txRef: "test", amountUgx: 5000, phone: "+256770123456" }), { code: "payments_unconfigured" });
    await assert.rejects(flw.initiateTransfer({ reference: "test", amountUgx: 5000, msisdn: "+256770123456" }), { code: "payments_unconfigured" });
  }
  assert.equal(new FlutterwaveClient({ ...baseEnv, FLW_SECRET_KEY: "test" }).verifyWebhook(undefined), false);
});

test("concurrent and repeated checkout reuse one pending charge", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  let charges = 0;
  s.flw.initiateMobileMoneyCharge = async () => { charges++; return { status: "pending", simulated: true }; };
  const purchases = await Promise.all(Array.from({ length: 8 }, () => s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id })));
  assert.equal(new Set(purchases.map((p) => p.transactionId)).size, 1);
  assert.equal(charges, 1);
  assert.equal(scalar(context, "select count(*) from transactions"), 1);
});

test("a charge timeout retains the pending purchase and prevents recharging", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  let charges = 0;
  s.flw.initiateMobileMoneyCharge = async () => { charges++; throw new Error("Timeout"); };
  await assert.rejects(s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id }));
  const retry = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  assert.equal(charges, 1);
  assert.equal((await s.txRepo.findById(retry.transactionId)).paymentStatus, "pending");
});

test("duplicate webhook delivery credits one sale and one entitlement", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  await Promise.all(Array.from({ length: 8 }, () => s.payments.settleFromWebhook(webhook(purchase))));
  assert.equal(scalar(context, "select balance_ugx from wallets"), 3395);
  assert.equal(scalar(context, "select lifetime_earned_ugx from wallets"), 3395);
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 1);
  assert.equal(scalar(context, "select count(*) from entitlements"), 1);
  assert.equal(scalar(context, "select purchase_count from content"), 1);
  await assert.rejects(s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id }), { code: "already_owned" });
});

test("different simultaneous sales preserve all wallet credits", async () => {
  const context = fixture(); const s = services(context); const { creator, item } = await seed(context);
  const rows = await Promise.all(Array.from({ length: 10 }, (_, i) => s.txRepo.create({ buyerId: `buyer-${i}`, creatorId: creator.id,
    contentId: item.id, type: "video_unlock", grossUgx: 5000, flutterwaveFeeUgx: 150, netPoolUgx: 4850,
    creatorShareUgx: 3395, platformShareUgx: 1455, creatorSplitBps: 7000, flutterwaveTxRef: `ref-${i}` })));
  await Promise.all(rows.map((row) => s.financial.settle(row.id)));
  assert.equal(scalar(context, "select balance_ugx from wallets"), 33950);
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 10);
});

test("a settlement failure rolls back every write and retry repairs the purchase", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  context.adapter.failAt = 3;
  await assert.rejects(s.payments.settleFromWebhook(webhook(purchase)));
  assert.equal(scalar(context, "select count(*) from wallets"), 0);
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 0);
  assert.equal(scalar(context, "select payment_status from transactions"), "pending");
  context.adapter.failAt = null;
  await s.payments.settleFromWebhook(webhook(purchase));
  assert.equal(scalar(context, "select balance_ugx from wallets"), 3395);
});

test("missing amount/currency and mismatched provider details cannot settle", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  for (const data of [{ tx_ref: purchase.txRef, status: "successful" }, { ...webhook(purchase).data, amount: 1 }, { ...webhook(purchase).data, currency: "USD" }]) {
    await assert.rejects(s.payments.settleFromWebhook({ data }));
  }
  assert.equal(scalar(context, "select count(*) from entitlements"), 0);
});

test("real webhooks use verified provider details and status lookup is buyer-scoped", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" }); const { buyer, item } = await seed(context);
  s.flw.initiateMobileMoneyCharge = async () => ({ status: "pending", simulated: false });
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  s.flw.verifyPayment = async () => ({ ...webhook(purchase).data, id: 123, amount: 1 });
  await assert.rejects(s.payments.settleFromWebhook(webhook(purchase), "hash"), { code: "amount_mismatch" });
  await assert.rejects(s.payments.status("other-buyer", purchase.transactionId), { status: 404 });
  s.flw.verifyPayment = async () => ({ ...webhook(purchase).data, id: 123 });
  assert.deepEqual(await s.payments.status(buyer.id, purchase.transactionId), { status: "paid", owned: true });
});

test("late failure notifications cannot downgrade an already-paid transaction", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  await s.payments.settleFromWebhook(webhook(purchase));
  await s.txRepo.markFailed(purchase.transactionId);
  assert.equal(scalar(context, "select payment_status from transactions"), "paid");
});

test("concurrent payout batches cannot reserve the same balance twice", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000, lifetimeEarnedUgx: 10000 });
  await Promise.all([s.payouts.buildBatch("admin"), s.payouts.buildBatch("admin")]);
  assert.equal(scalar(context, "select count(*) from payouts"), 1);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 0);
  assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
});

test("reservation failures leave neither an orphan payout nor a held balance", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  const wallet = await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 }).returning().get();
  const batch = await s.payoutRepo.createBatch({ minPayoutThresholdUgx: 0 });
  context.adapter.failAt = 2;
  await assert.rejects(s.financial.reservePayout({ batchId: batch.id, walletId: wallet.id, phone: "+256770123456", provider: "mtn", dutyPercent: 0.5, threshold: 0 }));
  assert.equal(scalar(context, "select count(*) from payouts"), 0);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 10000);
});

test("concurrent payout execution submits each transfer once", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const built = await s.payouts.buildBatch("admin"); await s.payouts.approveBatch("admin", built.batch.id);
  let transfers = 0;
  s.flw.initiateTransfer = async () => { transfers++; return { status: "pending", transferId: "123", simulated: false }; };
  s.flw.verifyTransfer = async () => ({ status: "success", transferId: "123", simulated: false });
  await Promise.all([s.payouts.executeBatch("admin", built.batch.id), s.payouts.executeBatch("admin", built.batch.id)]);
  assert.equal(transfers, 1);
  assert.equal(scalar(context, "select held_ugx from wallets"), 0);
  assert.equal(scalar(context, "select count(*) from wallet_entries where type = 'payout_debit'"), 1);
  assert.equal((await s.payouts.getBatch(built.batch.id)).batch.status, "completed");
});

test("unknown payout outcomes retain funds and reconcile without resubmission", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const built = await s.payouts.buildBatch("admin"); await s.payouts.approveBatch("admin", built.batch.id);
  let transfers = 0;
  s.flw.initiateTransfer = async () => { transfers++; throw new Error("Timeout after provider acceptance"); };
  s.flw.verifyTransfer = async () => ({ status: "pending", simulated: false });
  await s.payouts.executeBatch("admin", built.batch.id);
  assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
  await s.payouts.executeBatch("admin", built.batch.id);
  assert.equal(transfers, 1);
  s.flw.verifyTransfer = async () => ({ status: "failed", transferId: "123", simulated: false });
  await s.payouts.executeBatch("admin", built.batch.id);
  assert.equal(scalar(context, "select held_ugx from wallets"), 0);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 10000);
  assert.equal(transfers, 1);
});

test("payout finalization rolls back on failure and preserves new sale credits", async () => {
  const context = fixture(); const s = services(context); const { creator, buyer, item } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const built = await s.payouts.buildBatch("admin"); const payout = built.payouts[0];
  await s.payouts.approveBatch("admin", built.batch.id); await s.payoutRepo.claimBatch(built.batch.id);
  await s.payoutRepo.claimPayout(payout.id);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  await s.payments.settleFromWebhook(webhook(purchase));
  context.adapter.failAt = 2;
  await assert.rejects(s.financial.completePayout(payout.id, false));
  assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
  context.adapter.failAt = null;
  await Promise.all([s.financial.completePayout(payout.id, false), s.financial.completePayout(payout.id, false)]);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 13395);
  assert.equal(scalar(context, "select count(*) from wallet_entries where type = 'release'"), 1);
});

test("authentication attempts share an atomic limit across requests", async () => {
  const context = fixture(); const repo = new AuthRateLimitRepository(context.db);
  const accepted = await Promise.all(Array.from({ length: 20 }, () => repo.attempt("account", 5)));
  assert.equal(accepted.filter(Boolean).length, 5);
  assert.equal(scalar(context, "select attempts from auth_rate_limits"), 20);
});

test("bootstrap requires a secret and concurrent first-admin creation has one winner", async () => {
  const context = fixture(); const s = services(context, { ADMIN_BOOTSTRAP_SECRET: "bootstrap-test" });
  await assert.rejects(s.adminAuth.bootstrap("admin@example.com", "password-long"), { status: 403 });
  const results = await Promise.allSettled([s.adminAuth.bootstrap("a@example.com", "password-long", undefined, "bootstrap-test"),
    s.adminAuth.bootstrap("b@example.com", "password-long", undefined, "bootstrap-test")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(scalar(context, "select count(*) from admin_users"), 1);
});

test("disabled accounts and wrong token types lose authenticated and optional access", async () => {
  const context = fixture(); const s = services(context); const { buyer } = await seed(context);
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("container", { users: s.userRepo }); await next(); });
  app.get("/protected", requireAuth, (c) => c.json({ id: c.get("userId") }));
  app.get("/optional", async (c) => c.json({ id: await getOptionalUserId(c) }));
  app.onError((error, c) => c.json({ error: error.code }, error.status ?? 500));
  const token = await sign({ sub: buyer.id, exp: Math.floor(Date.now() / 1000) + 300, typ: "user" }, baseEnv.JWT_SECRET);
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await app.request("/protected", { headers }, baseEnv)).status, 200);
  await s.userRepo.update(buyer.id, { status: "banned" });
  assert.equal((await app.request("/protected", { headers }, baseEnv)).status, 401);
  assert.deepEqual(await (await app.request("/optional", { headers }, baseEnv)).json(), { id: null });
  await s.userRepo.update(buyer.id, { status: "active" });
  const adminToken = await sign({ sub: buyer.id, typ: "admin" }, baseEnv.JWT_SECRET);
  assert.equal((await app.request("/protected", { headers: { authorization: `Bearer ${adminToken}` } }, baseEnv)).status, 401);
});

test("admin authorization uses current status and role rather than JWT claims", async () => {
  const context = fixture(); const s = services(context, { ADMIN_BOOTSTRAP_SECRET: "bootstrap-test" });
  const admin = await s.adminAuth.bootstrap("admin@example.com", "password-long", undefined, "bootstrap-test");
  const repo = new AdminRepository(context.db);
  const token = await sign({ sub: admin.id, typ: "admin", role: "super_admin" }, baseEnv.JWT_SECRET);
  await repo.update(admin.id, { role: "analyst" });
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("container", { adminAuth: s.adminAuth }); await next(); });
  app.get("/", requireAdmin, (c) => c.json({ role: c.get("adminRole") }));
  app.onError((error, c) => c.json({ error: error.code }, error.status ?? 500));
  const headers = { authorization: `Bearer ${token}` };
  assert.deepEqual(await (await app.request("/", { headers }, baseEnv)).json(), { role: "analyst" });
  await repo.update(admin.id, { status: "disabled" });
  assert.equal((await app.request("/", { headers }, baseEnv)).status, 401);
});

test("approved payout batches cannot acquire additional reservations", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  const wallet = await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 }).returning().get();
  const built = await s.payouts.buildBatch("admin");
  await s.payouts.approveBatch("admin", built.batch.id);
  context.sqlite.prepare("update wallets set balance_ugx = 5000").run();
  await s.financial.reservePayout({ batchId: built.batch.id, walletId: wallet.id, phone: "+256770123456", provider: "mtn", dutyPercent: 0.5, threshold: 0 });
  assert.equal(scalar(context, "select count(*) from payouts"), 1);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 5000);
});

test("late payment for deleted content retains money history without restoring access", async () => {
  const context = fixture(); const s = services(context); const { buyer, item } = await seed(context);
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  context.sqlite.prepare("update content set status = 'deleted'").run();
  await s.payments.settleFromWebhook(webhook(purchase));
  assert.equal(scalar(context, "select status from entitlements"), "revoked");
  assert.deepEqual(await s.payments.status(buyer.id, purchase.transactionId), { status: "paid", owned: false });
});

test("HTTP auth throttling preserves the request body and limits normalized account aliases", async () => {
  const context = fixture(); const app = new Hono();
  app.use("*", async (c, next) => { c.set("container", { db: context.db }); await next(); });
  app.use("*", authRateLimit);
  app.post("/auth/login", async (c) => c.json(await c.req.json()));
  app.onError((error, c) => c.json({ error: error.code }, error.status ?? 500));
  for (let i = 0; i < 15; i++) {
    const body = { phone: i % 2 ? "+256 770 123 456" : "0770123456", password: "test" };
    const response = await app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
  }
  const blocked = await app.request("/auth/login", { method: "POST", body: JSON.stringify({ phone: "0770123456" }) });
  assert.equal(blocked.status, 429);
  const oversized = await app.request("/auth/login", { method: "POST", body: "x".repeat(20000) });
  assert.equal(oversized.status, 413);
});

test("provider transfer acceptance stays pending and only matching final outcomes complete", async () => {
  const originalFetch = globalThis.fetch;
  const flw = new FlutterwaveClient({ ...baseEnv, ENVIRONMENT: "production", FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  try {
    globalThis.fetch = async () => Response.json({ status: "success", data: { id: 123, status: "NEW" } });
    const initiated = await flw.initiateTransfer({ reference: "payout-id", amountUgx: 9950, msisdn: "+256770123456" });
    assert.equal(initiated.status, "pending");
    assert.equal(initiated.transferId, "123");
    const req = { reference: "payout-id", transferId: "123", amountUgx: 9950, msisdn: "+256770123456" };
    for (const status of ["NEW", "PENDING", "SUCCESSFUL", "FAILED"]) {
      globalThis.fetch = async () => Response.json({ status: "success", data: { id: 123, reference: req.reference, amount: req.amountUgx, currency: "UGX", account_number: req.msisdn, status } });
      assert.equal((await flw.verifyTransfer(req)).status, status === "SUCCESSFUL" ? "success" : status === "FAILED" ? "failed" : "pending");
    }
    globalThis.fetch = async () => Response.json({ status: "success", data: { id: 123, reference: "wrong-payout", status: "SUCCESSFUL", amount: 9950, currency: "UGX", account_number: req.msisdn } });
    assert.equal((await flw.verifyTransfer(req)).status, "pending");
    let lookupPath;
    globalThis.fetch = async (url) => { lookupPath = url; return Response.json({ status: "success", data: [{ id: 123, reference: req.reference, amount: 9950, currency: "UGX", account_number: req.msisdn, status: "SUCCESSFUL" }] }); };
    assert.equal((await flw.verifyTransfer({ ...req, transferId: null })).status, "success");
    assert.ok(lookupPath.endsWith("/transfers?reference=payout-id"));
  } finally { globalThis.fetch = originalFetch; }
});

test("live ticket settlement increments its counter once and grants live access", async () => {
  const context = fixture(); const s = services(context); const { buyer, creator } = await seed(context);
  const live = await context.db.insert(liveEvents).values({ creatorId: creator.id, declaredDurationMin: 30, ticketPriceUgx: 5000, priceFloorAppliedUgx: 2500, status: "live", startedAt: new Date() }).returning().get();
  const purchase = await s.payments.checkout(buyer.id, { type: "live_ticket", targetId: live.id });
  await Promise.all([s.payments.settleFromWebhook(webhook(purchase)), s.payments.settleFromWebhook(webhook(purchase))]);
  assert.equal(scalar(context, "select tickets_sold from live_events"), 1);
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 1);
  assert.deepEqual(await s.payments.status(buyer.id, purchase.transactionId), { status: "paid", owned: true });
});

test("execution rechecks account eligibility and the reserved destination", async () => {
  for (const mutation of ["update users set status = 'banned'", "update creators set status = 'suspended'", "update users set phone = '+256770999999' where handle = 'creator'", "update users set phone_verified_at = null", "update creators set payout_provider = 'airtel'"]) {
    const context = fixture(); const s = services(context, { ENVIRONMENT: "production", FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "test" });
    const { creator } = await seed(context);
    await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
    const built = await s.payouts.buildBatch("admin"); await s.payouts.approveBatch("admin", built.batch.id);
    context.sqlite.exec(mutation);
    let calls = 0; s.flw.initiateTransfer = async () => { calls++; throw new Error("must not submit"); };
    await s.payouts.executeBatch("admin", built.batch.id);
    assert.equal(calls, 0); assert.equal(scalar(context, "select status from payouts"), "pending");
    assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
  }
});

test("cancellation releases only unsubmitted funds once and rolls back on failure", async () => {
  const context = fixture(); const s = services(context); const { creator } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const built = await s.payouts.buildBatch("admin");
  assert.equal(await s.payoutRepo.claimPayout(built.payouts[0].id), undefined);
  context.adapter.failAt = 2;
  await assert.rejects(s.payouts.cancelUnsubmitted("admin", built.batch.id));
  assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
  context.adapter.failAt = null;
  await Promise.all([s.payouts.cancelUnsubmitted("admin", built.batch.id), s.payouts.cancelUnsubmitted("admin", built.batch.id)]);
  assert.equal(scalar(context, "select balance_ugx from wallets"), 10000);
  assert.equal(scalar(context, "select count(*) from wallet_entries where type = 'release'"), 1);
  assert.equal(scalar(context, "select failure_reason from payouts"), "cancelled_before_submission");
});

test("background reconciliation never submits transfers or releases uncertain holds", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "test" });
  const { creator } = await seed(context);
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const built = await s.payouts.buildBatch("admin"); await s.payouts.approveBatch("admin", built.batch.id);
  await s.payoutRepo.claimBatch(built.batch.id); await s.payoutRepo.claimPayout(built.payouts[0].id);
  s.flw.initiateTransfer = async () => { assert.fail("recovery must never submit"); };
  s.flw.verifyTransfer = async () => ({ status: "pending" });
  await s.payouts.cancelUnsubmitted("admin", built.batch.id);
  await s.payouts.reconcilePending();
  assert.equal(scalar(context, "select held_ugx from wallets"), 10000);
  s.flw.verifyTransfer = async () => ({ status: "success", transferId: "123" });
  await Promise.all([s.payouts.reconcilePending(), s.payouts.reconcilePending()]);
  assert.equal(scalar(context, "select held_ugx from wallets"), 0);
  assert.equal(scalar(context, "select count(*) from wallet_entries where type = 'payout_debit'"), 1);
  assert.equal((await s.payoutRepo.getBatch(built.batch.id)).status, "completed");
});

test("purchase recovery settles a missed webhook once without charging again", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  const { buyer, item } = await seed(context);
  let charges = 0, verifications = 0;
  s.flw.initiateMobileMoneyCharge = async () => { charges++; return { status: "pending" }; };
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  s.flw.verifyPayment = async () => { verifications++; return { ...webhook(purchase).data, id: 123 }; };
  await s.payments.reconcilePending();
  assert.equal(verifications, 0);
  context.sqlite.exec("update transactions set updated_at = 0");
  await Promise.all([s.payments.reconcilePending(), s.payments.reconcilePending()]);
  assert.equal(verifications, 1); assert.equal(charges, 1);
  assert.equal(scalar(context, "select payment_status from transactions"), "paid");
  assert.equal(scalar(context, "select balance_ugx from wallets"), 3395);
  assert.equal(scalar(context, "select count(*) from entitlements"), 1);
});

test("purchase recovery retains unknown or mismatched outcomes and retries failed settlement", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  const { buyer, item } = await seed(context);
  let charges = 0;
  s.flw.initiateMobileMoneyCharge = async () => { charges++; return { status: "pending" }; };
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  for (const outcome of [null, new Error("timeout"), { ...webhook(purchase).data, id: 123, amount: 1 }, { ...webhook(purchase).data, id: 123, currency: "USD" }]) {
    context.sqlite.exec("update transactions set updated_at = 0");
    s.flw.verifyPayment = async () => { if (outcome instanceof Error) throw outcome; return outcome; };
    await s.payments.reconcilePending();
    assert.equal(scalar(context, "select payment_status from transactions"), "pending");
    assert.equal(scalar(context, "select count(*) from entitlements"), 0);
    assert.equal((await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id })).transactionId, purchase.transactionId);
  }
  assert.equal(charges, 1);
  s.flw.verifyPayment = async () => ({ ...webhook(purchase).data, id: 123 });
  context.sqlite.exec("update transactions set updated_at = 0"); context.adapter.failAt = 3;
  await s.payments.reconcilePending();
  assert.equal(scalar(context, "select count(*) from wallets"), 0);
  context.adapter.failAt = null; context.sqlite.exec("update transactions set updated_at = 0");
  await s.payments.reconcilePending();
  assert.equal(scalar(context, "select balance_ugx from wallets"), 3395);
});

test("recovery is bounded, rotates unresolved purchases, and accepts confirmed failures", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  const { creator, item } = await seed(context);
  for (let i = 0; i < 25; i++) await s.txRepo.create({ buyerId: `recovery-${i}`, creatorId: creator.id, contentId: item.id,
    type: "video_unlock", grossUgx: 5000, flutterwaveFeeUgx: 150, netPoolUgx: 4850, creatorShareUgx: 3395,
    platformShareUgx: 1455, creatorSplitBps: 7000, flutterwaveTxRef: `recovery-${i}`, updatedAt: new Date(0) });
  const seen = new Set();
  s.flw.verifyPayment = async (ref) => { seen.add(ref); return null; };
  await s.payments.reconcilePending(); assert.equal(seen.size, 20);
  await s.payments.reconcilePending(); assert.equal(seen.size, 25);
  context.sqlite.exec("update transactions set updated_at = 0");
  s.flw.verifyPayment = async (ref) => ({ tx_ref: ref, status: "failed" });
  await s.payments.reconcilePending();
  assert.equal(scalar(context, "select count(*) from transactions where payment_status = 'failed'"), 20);
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 0);
});

test("finance recovery endpoints enforce roles and verification cannot submit money", async () => {
  const { adminRoutes } = await import("../src/http/routes/admin.routes.ts");
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  const { creator, buyer, item } = await seed(context);
  s.flw.initiateMobileMoneyCharge = async () => ({ status: "pending" });
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  await context.db.insert(wallets).values({ creatorId: creator.id, balanceUgx: 10000 });
  const batch = await s.payouts.buildBatch("admin"); await s.payouts.approveBatch("admin", batch.batch.id);
  s.flw.initiateMobileMoneyCharge = s.flw.initiateTransfer = async () => assert.fail("verification must not submit money");
  s.flw.verifyPayment = async () => ({ ...webhook(purchase).data, id: 123 });
  let role = "analyst";
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("container", { payments: s.payments, payouts: s.payouts,
    adminAuth: { getById: async () => ({ id: "admin", status: "active", role }) } }); await next(); });
  app.route("/admin", adminRoutes);
  app.onError((error, c) => c.json({ error: error.code }, error.status ?? 500));
  const token = await sign({ sub: "admin", typ: "admin" }, baseEnv.JWT_SECRET);
  const headers = { authorization: `Bearer ${token}` };
  for (const [path, method] of [["/admin/payments/pending", "GET"], [`/admin/payments/${purchase.transactionId}/verify`, "POST"],
    [`/admin/payouts/batches/${batch.batch.id}/verify`, "POST"], [`/admin/payouts/batches/${batch.batch.id}/cancel-unsubmitted`, "POST"]]) {
    assert.equal((await app.request(path, { method }, baseEnv)).status, 401);
    assert.equal((await app.request(path, { method, headers }, baseEnv)).status, 403);
  }
  role = "finance";
  const pending = await app.request("/admin/payments/pending", { headers }, baseEnv);
  assert.equal(pending.headers.get("cache-control"), "private, no-store");
  const data = await pending.json(); assert.equal(data.payments.length, 1);
  assert.equal(data.payments[0].flutterwaveTxRef, undefined); assert.equal(data.payments[0].buyerId, undefined);
  assert.equal((await app.request(`/admin/payments/${purchase.transactionId}/verify`, { method: "POST", headers }, baseEnv)).status, 200);
  assert.equal(scalar(context, "select payment_status from transactions"), "paid");
  assert.equal((await app.request(`/admin/payouts/batches/${batch.batch.id}/verify`, { method: "POST", headers }, baseEnv)).status, 200);
  assert.equal(scalar(context, "select status from payouts"), "pending");
  assert.equal((await app.request(`/admin/payouts/batches/${batch.batch.id}/cancel-unsubmitted`, { method: "POST", headers }, baseEnv)).status, 200);
  assert.equal(scalar(context, "select failure_reason from payouts"), "cancelled_before_submission");
});

test("manual payment verification audits actor, outcome and failures without provider details", async () => {
  const context = fixture(); const s = services(context, { FLW_SECRET_KEY: "test", FLW_WEBHOOK_HASH: "hash" });
  const { buyer, item } = await seed(context);
  s.flw.initiateMobileMoneyCharge = async () => ({ status: "pending" });
  const purchase = await s.payments.checkout(buyer.id, { type: "video_unlock", targetId: item.id });
  s.flw.verifyPayment = async () => { throw new Error("sensitive provider payload"); };
  await assert.rejects(s.payments.verifyForFinance("finance-admin", purchase.transactionId));
  s.flw.verifyPayment = async () => ({ ...webhook(purchase).data, id: 123 });
  assert.equal((await s.payments.verifyForFinance("finance-admin", purchase.transactionId)).status, "paid");
  const logs = context.sqlite.prepare("select * from audit_log where target_id = ? order by rowid").all(purchase.transactionId);
  assert.deepEqual(logs.map(row => row.action), ["payment.verify.requested", "payment.verify.failed", "payment.verify.requested", "payment.verify.completed"]);
  assert.ok(logs.every(row => row.admin_id === "finance-admin"));
  const details = logs.map(row => JSON.parse(row.detail_json));
  assert.equal(details[0].attemptId, details[1].attemptId);
  assert.equal(details[2].attemptId, details[3].attemptId);
  assert.notEqual(details[0].attemptId, details[2].attemptId);
  assert.equal(details[3].status, "paid");
  assert.ok(!JSON.stringify(logs).includes("sensitive provider payload"));
  assert.equal(scalar(context, "select count(*) from wallet_entries"), 1);
});

test("disabled creator accounts cannot sell content or live tickets", async () => {
  for (const type of ["video_unlock", "live_ticket"]) {
    const context = fixture(); const s = services(context); const { creatorUser, buyer, creator, item } = await seed(context);
    const live = await context.db.insert(liveEvents).values({ creatorId: creator.id, declaredDurationMin: 30,
      ticketPriceUgx: 5000, priceFloorAppliedUgx: 2500, status: "scheduled" }).returning().get();
    await s.userRepo.update(creatorUser.id, { status: "banned" });
    s.flw.initiateMobileMoneyCharge = async () => assert.fail("disabled owner must not receive charges");
    await assert.rejects(s.payments.checkout(buyer.id, { type, targetId: type === "video_unlock" ? item.id : live.id }), { status: 403 });
    assert.equal(scalar(context, "select count(*) from transactions"), 0);
  }
});

test("ticket checkout blocks expired and malformed broadcasts but permits scheduled and current events", async () => {
  for (const scenario of ["expired", "missing-start", "current", "scheduled"]) {
    const context = fixture(); const s = services(context); const { buyer, creator } = await seed(context);
    const event = await context.db.insert(liveEvents).values({ creatorId: creator.id, declaredDurationMin: 30,
      ticketPriceUgx: 5000, priceFloorAppliedUgx: 2500, status: scenario === "scheduled" ? "scheduled" : "live",
      startedAt: scenario === "expired" ? new Date(Date.now() - 3600000) : scenario === "current" ? new Date() : null }).returning().get();
    let calls = 0; s.flw.initiateMobileMoneyCharge = async () => { calls++; return { status: "pending" }; };
    const checkout = () => s.payments.checkout(buyer.id, { type: "live_ticket", targetId: event.id });
    if (scenario === "expired" || scenario === "missing-start") {
      await assert.rejects(checkout(), { code: "not_for_sale" });
      assert.equal(calls, 0); assert.equal(scalar(context, "select count(*) from transactions"), 0);
    } else {
      assert.equal((await checkout()).status, "pending"); assert.equal(calls, 1);
    }
  }
});
