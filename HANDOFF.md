# MidPay — Session Handoff

Living status doc for picking up work in a fresh session. Last updated after the
**mobile+password auth** commit (`c8c1536`), 2026-07-24.

---

## 1. What this is

**MidPay** — a premium pay-per-view short-video + live platform for **Uganda**
(TikTok-like feed, but creators sell videos/photos/live tickets via Mobile
Money). Building **Phase 1**. Full spec: [`project_brief_pay_per_view_uganda.md`](project_brief_pay_per_view_uganda.md).

- **Repo:** `D:\MidPay` → GitHub **`kissakian-art/midpay`** (branch `main`, pushed).
- **Backend:** Cloudflare Workers + D1 (SQLite) + Drizzle ORM + Hono.
  Deployed live: **https://midpay-backend.midpay.workers.dev**
- **Mobile app:** Expo / React Native (SDK 57, RN 0.86) in **`D:\MidPay\app`**.
  Expo project **`@kissa-kian/midpay`** (projectId `ee16880d-4894-426d-a47e-898b01363ed9`).

---

## 2. Environment gotchas (READ FIRST — these bite every time)

- **The folder is `D:\MidPay`** (P-a-y). There's an unrelated `D:\MidWay` on the
  machine — wrong folder if EAS mentions "midway".
- **Node networking is flaky on this network.** Node's `fetch`/undici resets TLS
  1.3 to Cloudflare/Expo (`ECONNRESET`) while `curl` works. **Fix: prefix Node
  tools with `NODE_OPTIONS=--tls-max-v1.2`** — unblocks `wrangler`, `eas`, `git
  push` ([[node-tls13-reset-workaround]]). Router reboots also help.
- **cmd vs PowerShell:** `set "X=y"` is cmd (what the user uses); `$env:X="y"` is
  PowerShell. In the Bash tool, `NODE_OPTIONS=--tls-max-v1.2 <cmd>`.
- **Windows line endings:** git `LF will be replaced by CRLF` warnings — harmless.
- **App docs rule (`app/AGENTS.md`):** read the versioned Expo v57 docs
  (`https://docs.expo.dev/versions/v57.0.0/`) before writing app code that uses an
  Expo API. Ground-truth for a lib's API = its installed `.d.ts` typings.

---

## 3. Working loop (has been effective)

Build → **typecheck (`tsc --noEmit`)** → **bundle (`expo export`)** →
**verify against production** (curl the deployed API / round-trip) → commit →
push. The user tests each APK on a real Android and reports what breaks; fix that
loop. Be honest about what can't be verified remotely (native camera, insets,
video/audio playback, GPU, drag gestures). Commit granularly; push each chunk.

**Backend deploy:** `cd /d/MidPay && NODE_OPTIONS=--tls-max-v1.2 npx wrangler deploy`
**D1 migrate (remote):** `npx drizzle-kit generate` then
`NODE_OPTIONS=--tls-max-v1.2 npx wrangler d1 migrations apply midpay --remote`
**Dev-account API test:** OTP is gone for the app, but the OTP routes still exist;
easier: `POST /auth/signup {phone,password}` on a throwaway number to get a token.
(Old test account `+256700009123` exists.)

---

## 4. Backend — DONE and deployed

Layered handlers → services → repositories (§2.4 portability: UUID PKs, portable
SQL, isolated repos). Migrations `0000`–`0008` all applied to remote D1.

- **Auth — MOBILE + PASSWORD** (changed 2026-07-24, was phone OTP). PBKDF2 via
  `services/crypto.ts`. `POST /auth/signup` (also claims a legacy OTP-only account
  by setting its first password) + `POST /auth/login`. `users.passwordHash`
  (nullable). `publicUser()` strips the hash from EVERY user response. OTP routes
  (`/auth/otp/*`) kept for transition. **SMS provider is no longer needed.**
- **Content** — CRUD + lifecycle, free/paid pricing (§3.2 floor), R2 media
  upload + gated download, thumbnails, global feed with `owned`, text/photo/video
  kinds. Extra columns: `overlays` (JSON), `textStyle` (JSON), `musicTrackId` +
  `musicStartMs` + `musicEndMs`. `GET /content/:id/card` = one item in full feed
  shape (used by search).
- **Music** — `tracks` table (source device|catalog, isPublic, R2 audio).
  `/music/tracks` list+search (public, optional-auth surfaces own), `PUT/GET
  /music/tracks/:id/audio`, `POST /music/tracks` (admins may set `source:catalog`).
- **Text backgrounds** — `backgrounds` table (admin-uploaded images). Public
  `GET /backgrounds` + `/:id/image`; admin `POST/PUT/DELETE`. Gated by
  `users.isAdmin`. `content.textStyle.bgImage` references one.
- **Social** — follows, likes, threaded **comments with reactions** (`comment_likes`
  + `comments.likeCount`; like/unlike endpoints; `listComments` returns
  `likeCount`+`likedByMe`) and replies (`parentId`), 1:1 DMs/inbox.
- **Search** — `GET /search?q=` → grouped creators / posts / sounds / comments.
- **Live** — scheduling with §3.3 duration price-floor guard; cron (`*/2 * * * *`)
  auto-terminates overruns. LiveRoom Durable Object (chat/reactions/presence) at
  `ws /live/:id/chat`.
- **Payments** — Flutterwave checkout + webhook settlement into ledger/wallets.
  **SIMULATED** until `FLW_SECRET_KEY`/`FLW_WEBHOOK_HASH` secrets are set.
- **Payouts** — Payout-Fridays batches, 0.5% duty, float monitor; payout number =
  registration number.
- **Admin console (API only, no UI)** — RBAC + audit log, config editor
  (versioned platform_config), analytics, moderation, creator suspend/ban/verify,
  password change + TOTP 2FA. `POST /admin/bootstrap`. **Separate** from the
  in-app admin below.
- **Profiles** — display name + bio, profile pictures (R2), claimable unique
  `@usernames`.

**In-app admin (owner) — `users.isAdmin` flag** ([[in-app-admin]]). Set it via
D1 (no UI to grant): `wrangler d1 execute midpay --remote --command "UPDATE users
SET is_admin=1 WHERE phone='+2567XXXXXXXX'"`. Exposed on `/auth/me`. Gates: catalog
music (`source:catalog`) + text-background uploads.

---

## 5. Mobile app — DONE (needs a fresh build to test)

- **Auth** — LoginScreen is **mobile + password** with Log in / Create account
  toggle. `auth.tsx` `login(phone,password)` + `signup(phone,password)`.
- **Feed** — vertical paging (FlatList **windowed**: `windowSize=3` etc. — this
  fixed an OOM crash), **tap-to-pause + draggable scrubber** (video, or photo/text
  with music), photos render as `Image`, styled text posts, right rail
  (follow/like/comment/DM), **🔍 search icon** (top-right).
- **Studio (Create)** — camera (photo/video, filter carousel bakes **photos** via
  Skia, §6), Camera/Upload/**Text** modes. Review screen: **OverlayEditor**
  (draggable text-on-shape), **🎵 Music** (picker: shared library + upload from
  device; **MusicTrimmer** range-slider for photo/text segments), price, post.
  Text composer is **WYSIWYG** (type on a gradient/image background) with a style
  strip (12 backgrounds + admin image backgrounds, 7 fonts, 6 colours, align,
  bold) + music.
- **Feed playback** — `FeedItemView` plays a post's music over the media
  (`expo-audio`): video caps music to the clip; photo/text loops the chosen
  segment; pause pauses both.
- **Comments** — `CommentsSheet`: safe-area bottom (clears nav bar), per-comment
  like heart, threaded replies with a "Replying to @x" banner, avatars.
- **Search** — `SearchScreen`: debounced, grouped results; creator→profile,
  post/comment→PostViewer, sounds shown (not yet tappable).
- **Admin** — `AdminScreen` (own Profile → "Admin", only if `isAdmin`): upload
  catalog sounds + text backgrounds (long-press to remove).
- **Profile, Inbox/DMs, ErrorBoundary** — unchanged from prior.

**A FRESH APK IS NEEDED** — the app now has native modules not in the user's last
build: `@shopify/react-native-skia`, `react-native-reanimated`,
`react-native-worklets` (Stage-1 filters; reanimated/worklets currently unused but
kept), `expo-audio`, `expo-document-picker`, `expo-asset`, **`expo-linear-gradient`**,
`expo-dev-client`. One build carries the ENTIRE session's work.
```
cd /d D:\MidPay\app
set "NODE_OPTIONS=--tls-max-v1.2"
npx eas-cli build -p android --profile preview
```
(`development` profile also exists — red-screens JS errors; use it if debugging a
native crash. Download tip: phone over mobile data, or disable Chrome QUIC — the
eascdn download resets otherwise.)

**Owner's onboarding after install:** Create account with **0770546489** + a
password → run the `is_admin=1 WHERE phone='+256770546489'` D1 command → restart →
Admin button appears.

---

## 6. What's PENDING / deferred

- **Flutterwave keys — the only remaining launch blocker.** When they arrive:
  `wrangler secret put FLW_SECRET_KEY` + `FLW_WEBHOOK_HASH`; payments flip
  simulated → live, no code change. (Business verification in progress.)
- **Filters Stage 2 (live WYSIWYG preview + filtered video) — DEFERRED, verified
  no on-device path on RN 0.86** ([[stage2-live-filters-deferred]]). Stage 1
  (bake colour filters into captured **photos** via offscreen Skia) is DONE +
  verified on-device (Noir→grayscale). The camera has no live filter preview and
  video is unfiltered — that's the known limit, not a bug. VisionCamera v5 can do
  live preview but can't record filtered video; v4 is triple-blocked on RN 0.86.
  Only real path to filtered video = **server-side ffmpeg transcode** (deliberate
  infra decision) OR wait for v5 to add filtered recording. Don't spend an EAS
  build chasing the v4 path — verified dead.
- **Live streaming video** — chat backbone (LiveRoom DO) exists; needs Agora/ZEGO
  account + SDK + live UI.
- **Admin web console UI** — the admin *API* is complete; no front-end (the
  in-app `users.isAdmin` admin is separate and only covers catalog uploads).
- **Search follow-ups** — sound results aren't tappable (no "posts using this
  sound" screen); comment match is a substring (the "3 words" was simplified).
- **Music follow-ups** — "original sound" extracted from a video's own audio;
  trim/volume on video music (`musicEndMs` wired but video uses cap-to-clip).
- **Polish backlog** — locked-paid-video poster; pull-to-refresh niceties.

---

## 7. Accounts & credentials

| Thing | Status |
|---|---|
| Cloudflare (Workers/D1/R2/DO/cron) | ✅ live; wrangler logged in; R2 enabled |
| `JWT_SECRET` | ✅ Worker secret |
| Expo / EAS | ✅ `@kissa-kian/midpay` |
| GitHub | ✅ `kissakian-art/midpay` |
| Flutterwave keys | ⏳ business verification in progress (last launch blocker) |
| SMS provider | ✅ **no longer needed** (mobile+password auth) |
| Agora/ZEGO (live video) | ❌ not set up |
| Google Play ($25) | ❌ only if Play Store wanted |

D1 `midpay` id `d8b4a6c5-e94c-4164-a752-390e9302644c`. **Cost:** ~$0/month fixed;
per-use = Flutterwave 3%/sale + live streaming free tier.

---

## 8. Product decisions locked in (don't re-litigate)

- **Auth = mobile number + password** (changed 2026-07-24 from phone OTP, at
  owner's request; removes the SMS dependency).
- **Open signup** — no approval/KYC gate; free unlimited uploads
  ([[open-signup-model]]).
- **Payout number = registration number.**
- **`@username` unique; display name NOT** (two "Coach Emma"s allowed).
- **Compose-at-playback** for overlays + music + text backgrounds — metadata
  rendered over the media in MidPay's own player, NEVER muxed/re-encoded into the
  file. This is what sidesteps the video-encoder wall. Keep this pattern.
- Live price floor (§3.3) + auto-terminate are hard requirements.

---

## 9. Key file map

```
Backend (src/)
  index.ts                     Worker entry + cron scheduled handler
  http/{app,container}.ts      Hono app + DI composition root (wire new services here)
  http/routes/*                auth, users, creators, content, music, backgrounds,
                               search, live, payments, reports, admin, messages
  services/*                   business logic; auth.service.ts (signup/login +
                               publicUser), music/search/background.service.ts,
                               crypto.ts (hashPassword/verifyPassword), pricing.ts
  repositories/*               data access (Drizzle). content repo has findFeedItemById
  db/schema/*                  users(+isAdmin,+passwordHash), content(+overlays,
                               +textStyle,+music*), music, backgrounds, social
                               (+comment_likes,+comments.likeCount), live, ledger…
  realtime/live-room.ts        LiveRoom Durable Object
  drizzle/migrations/          0000–0008 (all applied remote)

App (app/src/)
  screens/*                    Feed, Studio, UserProfile, PostViewer, Inbox,
                               Conversation, Login (password), Search, Admin
  components/*                 FeedItemView (play controls + music + overlays + text
                               bg), CommentsSheet, OverlayEditor, MusicPicker,
                               MusicTrimmer, TextBackground, TextOverlayLayer, Avatar
  studio/*                     filter ENGINE (colorMatrix/filters/faceBlur) +
                               skiaFilter.ts (REAL photo baking, not a stub) +
                               textStyles.ts (bg/font/colour presets)
  api.ts                       typed backend client (auth, content, music,
                               backgrounds, search, comments…)
  auth.tsx                     session/token context (login/signup password)
```

---

## 10. Memory pointers

[[midpay-backend-status]] · [[open-signup-model]] · [[node-tls13-reset-workaround]]
· [[stage2-live-filters-deferred]] · [[music-feature-design]] · [[in-app-admin]]
