# Credentials & Secrets Registry

> **This file contains NO secret values — and it never should.**
> It is a *map*: what credentials the project uses, where each one is stored, and
> how to recover or rotate it. The actual secret **values** live in a password
> manager and in each service's own dashboard. If you ever find a real key,
> secret, token, or password written in this file, delete it and rotate it.

---

## 1. Worker secrets (Cloudflare)

Set with `wrangler secret put <NAME>` — they are **write-only**: once set, neither
LiveKit/the provider **nor** Cloudflare will show you the value again. So keep a
copy of each in your password manager when you first receive it.

| Name | Purpose | Status | Value comes from / how to recover |
|---|---|---|---|
| `JWT_SECRET` | Signs users' session tokens | ✅ set | Any long random string. Rotating it **logs everyone out** (all sessions invalid). |
| `LIVEKIT_API_KEY` | LiveKit auth (issuer) | ✅ set | LiveKit Cloud → project → Settings → API keys → **Create key** |
| `LIVEKIT_API_SECRET` | Signs LiveKit room tokens | ✅ set | Shown **once** with the key above. Lost → create a new key pair, re-put both. |
| `FLW_SECRET_KEY` | Flutterwave charges/payouts | ⏳ not set | Flutterwave dashboard (pending business verification) |
| `FLW_WEBHOOK_HASH` | Verifies Flutterwave webhooks | ⏳ not set | Flutterwave dashboard → webhook settings |

Check what's currently set (names only, never values):
```bash
npx wrangler secret list
```

## 2. Config vars (not secret — committed in `wrangler.toml`)

These are safe in the repo; they are endpoints/tunables, not secrets.

| Name | Value |
|---|---|
| `LIVEKIT_URL` | the project's `wss://…livekit.cloud` endpoint |
| `ENVIRONMENT`, price floors, fee %, opex target, etc. | business config (see `wrangler.toml`) |

## 3. Accounts & dashboards (log in to manage)

Store the **login** for each of these in your password manager — not here.

| Service | What it's for | Notes |
|---|---|---|
| Cloudflare | Workers, D1, R2, Durable Objects, cron | `wrangler` is logged in locally |
| LiveKit Cloud | Live video (Phase B) | project `midpay`; API keys under Settings |
| Expo / EAS | Building the app (APK) | project `@kissa-kian/midpay` |
| GitHub | Source code | repo `kissakian-art/midpay` |
| Flutterwave | Mobile Money payments | pending verification |
| Admin web console | Platform admin (`/console`) | separate email + password + TOTP |

## 4. If a secret is lost

None of these are unrecoverable — losing one is a few-minutes fix, never a disaster:

1. Generate a **new** value in the service's dashboard (or a new random string for `JWT_SECRET`).
2. `npx wrangler secret put <NAME>` and paste the new value at the prompt.
3. Re-deploy only if a `wrangler.toml` **var** changed (secrets take effect immediately; no redeploy needed).
4. Save the new value in your password manager.

**Rotation cautions:** rotating `JWT_SECRET` signs everyone out; rotating LiveKit
keys means any already-issued room tokens stop working (fine — new ones mint on
demand). Rotate a secret immediately if it's ever exposed (committed, screenshotted, pasted in chat).
