# MidPay — Backend (Phase 1)

Backend for the premium pay-per-view video & live platform (Uganda). See
[`project_brief_pay_per_view_uganda.md`](project_brief_pay_per_view_uganda.md)
for the full spec. This package is the **Phase-1 backend**: Cloudflare Workers +
D1, with the core data model modeled in Drizzle ORM.

## Stack (§2.4)

| Concern | Choice |
|---|---|
| Compute | Cloudflare Workers (serverless, per-request, no egress fees) |
| Datastore | Cloudflare D1 (SQLite) — core relational state + financial ledger **only** |
| ORM / migrations | Drizzle ORM + Drizzle Kit (dialect-agnostic, portable to Postgres) |
| Media | Cloudflare R2 (video/images/replays) — **never** the DB |
| Live realtime | Durable Objects (chat/reactions/tips) — **never** D1 |

### Data-placement discipline (mandatory, §2.4)

D1 holds only users, creators, content **metadata**, the financial ledger, and
wallet balances. Video/images → R2. Live chat/reactions → Durable Objects. Raw
view events / analytics firehose → Analytics Engine or R2. This keeps D1 far
under its size ceiling (~50M ledger rows ≈ decades of runway).

### Portability (mandatory, §2.4)

Designed to keep a future move to self-hosted Postgres contained:
UUID primary keys (no `AUTOINCREMENT`), standard portable SQL in all core/ledger
tables, all access through Drizzle, and data access isolated behind the
repository layer. A Postgres move also needs schema/migration changes and a
transaction adapter for the atomic financial batches; it is not a config-only
switch.

## Layout

```
src/
  index.ts              Worker entry — delegates to the Hono app
  env.ts                Runtime bindings/vars + secrets (mirrors wrangler.toml)
  http/
    app.ts              App factory: per-request container, routes, error handler
    container.ts        Composition root (builds repo + service graph)
    middleware/auth.ts  Bearer-JWT session auth
    routes/             auth, creators, content, live, payments
  db/
    client.ts           The single dialect-agnostic Drizzle instance
    schema/             Core data model, one file per domain
      users.ts          users, follows
      auth.ts           otp_challenges (phone login)
      creators.ts       creator profiles, KYC, standing, split overrides
      content.ts        recorded content metadata, tags (free/paid, §4.5)
      social.ts         likes, comments, DMs/inbox
      live.ts           live events + §3.3 duration/price-floor state
      ledger.ts         transactions (immutable ledger) + entitlements
      wallet.ts         wallets, wallet entries, payout batches, payouts
      admin.ts          admin RBAC, audit log, versioned config, moderation
  repositories/         Isolated data-access layer (§2.4 rule #4)
  services/
    pricing.ts          §3.2 splits + §3.3 live price-floor guard (pure fns)
    config.service.ts   Effective config (platform_config → env fallback, §7.2)
    auth.service.ts     Phone OTP login/signup, session JWTs
    content.service.ts  Content lifecycle + price-floor/clip-cap enforcement
    live.service.ts     Live scheduling with the §3.3 guard
    social.service.ts   Follows, likes, comments (denormalized counters)
    messaging.service.ts 1:1 DMs / inbox with unread counts
    payments/           Flutterwave client + checkout/webhook settlement
    payout.service.ts   Payout batches: hold → approve → execute (§7.5)
    admin/              Admin RBAC auth, moderation + kill-switch, creator admin,
                        config editor (§7.2), analytics dashboard (§7.7)
```

## Product model note (open signup)

Account creation and posting are **not gated by approval**: users self-register
with a verified phone and password, become creators instantly via `/creators/apply`, and can
upload immediately (no upload fee, no free-upload caps). "KYC" is downgraded to
an **optional** admin-set verification badge / payout-account check — never a
gate on signup or posting. Safety is **reactive**: user reports, admin takedown
(quarantine/remove), the live kill-switch, and creator suspend/ban — all
audit-logged.

Two related rules:

- **Payout number = registration number** (Betpawa-style). Creator payouts are
  always sent to the phone the account registered with — there is no separately
  settable payout number, which closes the pay-to-attacker's-number fraud vector.
- **`PHONE_VERIFICATION_ENABLED` config** (default 1). Production always requires
  verification, regardless of this config. Setting it to `0` only allows NEW
  development accounts to register without a code; their phone stays unverified.
  It never authenticates arbitrary existing accounts. Legacy OTP-only accounts
  must consume a valid challenge before setting their first password.

SMS is intentionally **unconfigured**. Production signup, OTP requests, and OTP
login return `503 sms_unconfigured` until a real SMS adapter is implemented.
Existing accounts can still log in with their password. Development returns a
verification code in the OTP request response; codes and phone numbers are not
logged.

## API (Phase 1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | Liveness + D1 check |
| POST | `/auth/signup` | – | Phone + password + verification code (`code`) |
| POST | `/auth/login` | – | Phone + password login |
| POST | `/auth/otp/request` | – | Send login OTP (dev echoes the code) |
| POST | `/auth/otp/verify` | – | Verify OTP → session token + user |
| GET | `/auth/me` | user | Current user |
| GET | `/users/:id`, `/:id/followers`, `/:id/following` | – | Public profile + follow lists |
| POST/DELETE | `/users/:id/follow` | user | Follow / unfollow |
| POST/DELETE | `/content/:id/like` | user | Like / unlike |
| GET | `/content/:id/comments` | – | List comments (with author) |
| POST | `/content/:id/comments` | user | Add comment / reply |
| DELETE | `/content/:id/comments/:commentId` | user | Delete (author or content owner) |
| POST | `/messages` | user | Send a DM (finds/creates conversation) |
| GET | `/conversations`, `/conversations/:id/messages` | user | Inbox + thread |
| POST | `/conversations/:id/read` | user | Mark conversation read |
| POST | `/creators/apply` | user | Become a creator (instant; payouts go to the registration phone) |
| GET | `/creators/:id`, `/:id/content`, `/:id/live` | – | Public creator profile/catalog |
| POST | `/content` | creator | Create content metadata |
| PATCH | `/content/:id` | creator | Edit metadata / pricing status (§4.5.1) |
| POST | `/content/:id/publish`, `/archive`, `/unarchive` | creator | Lifecycle (§4.5.4) |
| PUT | `/content/:id/media`, `/thumbnail` | creator | Upload media bytes to R2 (§2.2) |
| DELETE | `/content/:id` | creator | Hard-delete: revoke access, purge R2, keep ledger (§4.5.5) |
| GET | `/content/:id` | – | Public metadata |
| GET | `/content/:id/media` | gated | Stream media (free=open, paid=entitlement); Range supported |
| POST | `/live/quote-floor` | – | Preview the §3.3 floor for a duration |
| POST | `/live` | creator | Schedule a live (enforces §3.3 floor) |
| POST | `/live/:id/start`, `/end` | creator | Live lifecycle |
| POST | `/payments/checkout` | user | Buy a video unlock / live ticket (STK Push) |
| GET | `/payments/:id/status` | buyer | Verify an existing purchase; return status + active access |
| POST | `/payments/webhook` | verif-hash | Flutterwave settlement → entitlement + wallet credit |
| POST | `/reports` | user | Report content / live / comment / user (§7.4) |
| POST | `/admin/bootstrap` | bootstrap secret | Create the initial Super Admin atomically (once); `x-bootstrap-secret` required |
| POST | `/admin/auth/login` | – | Admin login → admin session token |
| GET | `/admin/me` | admin | Current admin |
| GET | `/admin/payouts/float` | finance | Float monitor: available vs held obligations |
| POST | `/admin/payouts/batches` | finance | Build a payout batch (reserves balances) |
| GET | `/admin/payouts/batches`, `/:id` | finance | List / inspect batches |
| POST | `/admin/payouts/batches/:id/approve` | finance | Approve a draft batch |
| POST | `/admin/payouts/batches/:id/execute` | finance | Execute approved transfers; resume/reconcile an executing batch (§7.5) |
| GET | `/admin/moderation/reports` | moderator | Review queue (filter `?status=`) |
| POST | `/admin/moderation/reports/:id/resolve` | moderator | Action / dismiss a report |
| POST | `/admin/content/:id/quarantine`, `/restore`, `/remove` | moderator | Takedown tools (§7.4) |
| POST | `/admin/live/:id/kill` | moderator | Kill-switch: end a stream now (§7.4) |
| GET | `/admin/creators/:id` | moderator | Creator detail |
| POST | `/admin/creators/:id/suspend`, `/ban`, `/reinstate`, `/verify` | moderator | Creator status (§7.3) |
| GET | `/admin/config`, `/config/:key/history` | finance/analyst | Effective config + version history (§7.2) |
| PUT | `/admin/config/:key` | super_admin | Set a tunable (versioned, effective-dated) |
| GET | `/admin/analytics/revenue` | finance/analyst | Paid-ledger totals + by-type (`?from&to`) |
| GET | `/admin/analytics/self-funding` | finance/analyst | Platform earnings vs opex target (§6.3) |
| GET | `/admin/analytics/top` | finance/analyst | Top content + top creators |

Payments and payouts run in **simulated mode only when `ENVIRONMENT` is explicitly
`development` and `FLW_SECRET_KEY` is absent**. Production and unknown environments
require BOTH `FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH`; missing configuration returns
503. Configured charge webhooks are verified directly with Flutterwave before
settlement. Amount, currency, reference, and provider ID are validated.

Checkout reuses pending purchases, and database uniqueness arbitrates concurrent
requests. The app polls the buyer-scoped status endpoint after checkout instead
of initiating another charge. Settlement commits the entitlement, wallet journal,
wallet increment, purchase counters, and payment status in one atomic D1 batch.
Duplicate webhooks cannot credit a sale twice.

Transfers remain reserved until Flutterwave confirms their final outcome. The
admin console exposes **Resume / reconcile** for executing batches. A claimed
payout is never automatically resubmitted after a timeout; verification uses its
provider ID or merchant reference. A missing/ambiguous result preserves the hold.
If a crash happened before the provider request and there is no provider record,
an operator must investigate before any manual release or resubmission. Existing
legacy partial payments also need reconciliation; this patch does not rewrite
historical ledger entries automatically.

Provider behavior follows [Flutterwave transaction verification](https://developer.flutterwave.com/docs/transaction-verification)
and [transfer status documentation](https://developer.flutterwave.com/docs/introduction-6).

Admin routes use a separate admin session
token (`typ:"admin"`); `super_admin` passes every role gate.
Authenticated requests check the current account status; admin permissions use
the current database role. Login/signup/OTP/bootstrap requests are throttled by
hashed IP and normalized account identifiers in D1.

## Getting started

```bash
npm install

# Local secrets only (gitignored). Set ADMIN_BOOTSTRAP_SECRET for first-admin setup.
cp .dev.vars.example .dev.vars

# 1. Create the D1 database, then paste its id into wrangler.toml.
npx wrangler d1 create midpay

# 2. Existing database: run read-only financial checks before migration 0011.
npx wrangler d1 execute midpay --local --file drizzle/preflight-financial-integrity.sql
# For a fresh DB, skip preflight and apply the committed migrations directly.
# Generate migrations only when editing the schema: npm run db:generate

# 3. Apply migrations locally, then run the Worker.
npm run db:migrate:local
npm run dev

# Typecheck
npm run typecheck
npm test
cd app && npx tsc --noEmit
```

`/health` returns `{ status, db }` and verifies D1 connectivity.

`npm run dev` explicitly sets `ENVIRONMENT=development`; the committed deployment
default is production. The tests are verified on Node 24 (Node's built-in SQLite) and
apply every committed migration to an isolated in-memory database. They do not
send SMS, charge customers, transfer money, or alter local development data.

For an isolated smoke check against the actual Worker runtime and D1 adapter:

```bash
npx wrangler deploy --dry-run --outdir .wrangler/build-check
node --import ./tests/register.mjs ./tests/worker-smoke.mjs
```

This uses Wrangler's bundled Miniflare runtime with ephemeral databases and
explicit test bindings. It does not deploy the Worker or use local secrets.

Before applying 0011 to an existing **remote** database, run the same preflight
with `--remote` and reconcile any results against provider records. The migration
adds uniqueness constraints and will deliberately fail if unresolved duplicates
exist. Inspect previous verified-phone timestamps before real payouts: older
signup code marked numbers verified without proving ownership.

Deploying the worker, migrating the remote database, and rebuilding the mobile
app are separate release steps. Source edits do not update an existing APK.

## Config constants (§7.2)

Defaults live in `wrangler.toml` `[vars]`, but the **effective** values are the
versioned rows in the `platform_config` table so the owner can tune them from
the admin console without a redeploy: `LIVE_MIN_PRICE_PER_HOUR` (5,000),
`STREAMING_COST_PER_VIEWER_MINUTE` (15), `RECORDED_PRICE_FLOOR` (5,000), the
revenue-split matrix, free-content governance, and grace periods.

## Built so far

Core data model (schema + migrations), and the API for **auth** (phone OTP),
**content** (CRUD + lifecycle + pricing + R2 media upload/gated download),
**live** (scheduling with the §3.3 guard), **payments** (Flutterwave checkout +
webhook settlement into the ledger and wallets), **payouts** (admin RBAC +
"Payout Fridays" batch build/approve/execute with the 0.5% withdrawal duty and a
float monitor, §7.5), **moderation** (report queue, content quarantine/remove,
live kill-switch, creator suspend/ban/verify, §7.3/§7.4), a **config editor**
(versioned, effective-dated tunables that drive runtime logic, §7.2), and an
**analytics dashboard** (paid-ledger revenue, by-type, top creators/content, and
the self-funding tracker, §7.7), and the **social layer** (follows, likes,
threaded comments, and 1:1 DMs/inbox with unread counts). All audit-logged where
applicable. Security and financial behavior are covered by `npm test`; native
media/live and real-provider release checks remain separate.

## Still to build (later Phase-1 work)

- **Enable R2 for remote/deploy** — one-time: enable R2 in the dashboard, then
  `wrangler r2 bucket create midpay-media`. Local dev already simulates it.
- **Real SMS + Flutterwave keys** — implement an SMS provider adapter;
  set `FLW_SECRET_KEY` / `FLW_WEBHOOK_HASH` for live payments and payouts.
- **Live production validation** — Durable Object chat/reactions/presence and
  LiveKit video are implemented; verify configured native builds against the
  actual LiveKit project and moderation/termination behavior before launch.
- **App-side native features** (need an EAS development build): face blur
  (§4.3), on-device HEVC encoding ladder (§2.2), watermarking on free
  downloads (§4.4). Screen-capture blocking on paid videos is DONE
  (expo-screen-capture). The feed initializes access from server ownership;
  purchases check payment status automatically.

## Done since (admin security + §3.3 cap)

`POST /admin/auth/change-password`; TOTP 2FA (`/admin/2fa/setup|enable|disable`,
login takes `totpCode` once enabled); cron trigger (every 2 min) auto-terminates
overrun lives at declared duration + grace, audit-logged.
