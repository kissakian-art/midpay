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

Built so a future move to self-hosted Postgres is config-level, not a rewrite:
UUID primary keys (no `AUTOINCREMENT`), standard portable SQL in all core/ledger
tables, all access through Drizzle, and data access isolated behind the
repository layer. Only [`src/db/client.ts`](src/db/client.ts) and the driver
import change on migration.

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
with a phone OTP, become creators instantly via `/creators/apply`, and can
upload immediately (no upload fee, no free-upload caps). "KYC" is downgraded to
an **optional** admin-set verification badge / payout-account check — never a
gate on signup or posting. Safety is **reactive**: user reports, admin takedown
(quarantine/remove), the live kill-switch, and creator suspend/ban — all
audit-logged.

Two related rules:

- **Payout number = registration number** (Betpawa-style). Creator payouts are
  always sent to the phone the account registered with — there is no separately
  settable payout number, which closes the pay-to-attacker's-number fraud vector.
- **`PHONE_VERIFICATION_ENABLED` config** (default 1). Set to `0` via
  `PUT /admin/config/PHONE_VERIFICATION_ENABLED` to bypass OTP entirely during
  development — `/auth/otp/verify` then accepts any phone + any code. **Must be
  1 in production**, since the registration phone is also the money destination.

## API (Phase 1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | Liveness + D1 check |
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
| POST | `/payments/webhook` | verif-hash | Flutterwave settlement → entitlement + wallet credit |
| POST | `/reports` | user | Report content / live / comment / user (§7.4) |
| POST | `/admin/bootstrap` | first-run | Create the initial Super Admin (once) |
| POST | `/admin/auth/login` | – | Admin login → admin session token |
| GET | `/admin/me` | admin | Current admin |
| GET | `/admin/payouts/float` | finance | Float monitor: available vs held obligations |
| POST | `/admin/payouts/batches` | finance | Build a payout batch (reserves balances) |
| GET | `/admin/payouts/batches`, `/:id` | finance | List / inspect batches |
| POST | `/admin/payouts/batches/:id/approve` | finance | Approve a draft batch |
| POST | `/admin/payouts/batches/:id/execute` | finance | Execute transfers (§7.5) |
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

Payments and payouts run in **simulated mode** until `FLW_SECRET_KEY` is set —
checkout returns `"simulated": true` and transfers are faked; you settle charges
by POSTing a webhook payload yourself. Admin routes use a separate admin session
token (`typ:"admin"`); `super_admin` passes every role gate.

## Getting started

```bash
npm install

# 1. Create the D1 database, then paste its id into wrangler.toml.
npx wrangler d1 create midpay

# 2. Generate the SQL migration from the Drizzle schema.
npm run db:generate

# 3. Apply migrations locally, then run the Worker.
npm run db:migrate:local
npm run dev

# Typecheck
npm run typecheck
```

`/health` returns `{ status, db }` and verifies D1 connectivity.

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
applicable; all verified end-to-end against local D1 + R2.

## Still to build (later Phase-1 work)

- **Enable R2 for remote/deploy** — one-time: enable R2 in the dashboard, then
  `wrangler r2 bucket create midpay-media`. Local dev already simulates it.
- **Real SMS + Flutterwave keys** — swap the dev OTP logger for an SMS provider;
  set `FLW_SECRET_KEY` / `FLW_WEBHOOK_HASH` for live payments and payouts.
- **Durable Object** for live chat/reactions/tips (§2.4) + a live-streaming
  SDK (Agora/ZEGOCLOUD — needs an account) wired into the app.
- **App-side native features** (need an EAS development build): face blur
  (§4.3), on-device HEVC encoding ladder (§2.2), watermarking on free
  downloads (§4.4). Screen-capture blocking on paid videos is DONE
  (expo-screen-capture). Entitlement check on feed load (paid items show
  locked after app restart until Unlock is tapped) is a known polish item.

## Done since (admin security + §3.3 cap)

`POST /admin/auth/change-password`; TOTP 2FA (`/admin/2fa/setup|enable|disable`,
login takes `totpCode` once enabled); cron trigger (every 2 min) auto-terminates
overrun lives at declared duration + grace, audit-logged.
