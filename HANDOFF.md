# MidPay — Session Handoff

Living status doc for picking up work in a fresh session. Last updated
2026-07-26 after the **app: playback/pricing/music** commit (`9eeeb49`) — this
session added the admin web console + creator lookup, the 100-min free-video
cap, per-kind price floors (photo 2,000 / video 5,000), 720p quality cap, music
volume + in-picker preview, feed-playback fixes, the tab-bar tweaks, and T&C at
signup. All committed to `main` and pushed; backend deployed + migrated.

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
SQL, isolated repos). Migrations `0000`–`0009` all applied to remote D1
(`0009` = `content.music_volume`).

- **Auth — MOBILE + PASSWORD** (changed 2026-07-24, was phone OTP). PBKDF2 via
  `services/crypto.ts`. `POST /auth/signup` (also claims a legacy OTP-only account
  by setting its first password) + `POST /auth/login`. `users.passwordHash`
  (nullable). `publicUser()` strips the hash from EVERY user response. OTP routes
  (`/auth/otp/*`) kept for transition. **SMS provider is no longer needed.**
- **Content** — CRUD + lifecycle, free/paid pricing (§3.2 floor), R2 media
  upload + gated download, thumbnails, global feed with `owned`, text/photo/video
  kinds. Extra columns: `overlays` (JSON), `textStyle` (JSON), `musicTrackId` +
  `musicStartMs` + `musicEndMs`. `GET /content/:id/card` = one item in full feed
  shape (used by search). Guards: per-clip 5-min (300s) cap; **price floors by
  kind** — photos 2,000, videos/text 5,000 (`PHOTO_PRICE_FLOOR` vs
  `RECORDED_PRICE_FLOOR`, both floors not caps, admin-tunable); **100 free
  video-minutes/creator** (paid unlimited, §4.5.3 — see §6). Public
  `GET /content/pricing` → `{recordedFloor, photoFloor}` (app reads it).
  `content.musicVolume` (0..100) added — music loudness for compose-at-playback.
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
- **Admin console** — RBAC + audit log, config editor (versioned
  platform_config), analytics, moderation, creator suspend/ban/verify, password
  change + TOTP 2FA. `POST /admin/bootstrap`. **Separate** from the in-app admin
  below (own email+password+TOTP auth, `typ:"admin"` JWT, roles super_admin /
  finance / moderator / analyst). **Web console UI now built** — see §5a.
- **Profiles** — display name + bio, profile pictures (R2), claimable unique
  `@usernames`.

**In-app admin (owner) — `users.isAdmin` flag** ([[in-app-admin]]). Set it via
D1 (no UI to grant): `wrangler d1 execute midpay --remote --command "UPDATE users
SET is_admin=1 WHERE phone='+2567XXXXXXXX'"`. Exposed on `/auth/me`. Gates: catalog
music (`source:catalog`) + text-background uploads.

---

## 5. Mobile app — DONE (needs a fresh build to test)

- **Auth** — LoginScreen is **mobile + password** with Log in / Create account
  toggle. `auth.tsx` `login(phone,password)` + `signup(phone,password)`. Signup
  now requires accepting **Terms & Conditions** (checkbox + in-app Terms modal;
  content in [`app/src/terms.ts`](app/src/terms.ts), `TERMS_VERSION`). Acceptance
  is client-side only — NOT yet recorded server-side (see §6).
- **Feed** — vertical paging (FlatList **windowed**: `windowSize=3` etc. — this
  fixed an OOM crash), **tap-to-pause + always-visible progress bar** (drag to
  seek; time read-out shows while paused/seeking), photos render as `Image`,
  styled text posts, right rail (follow/like/comment/DM), **🔍 search** (top-right).
  Playback (video **and** music) stops when the screen is unfocused or the app is
  backgrounded (`useIsFocused` + `AppState`), and seeking a video-with-music keeps
  the music in sync.
- **Studio (Create)** — camera (photo/video, filter carousel bakes **photos** via
  Skia, §6), Camera/Upload/**Text** modes. Review screen: **OverlayEditor**
  (draggable text-on-shape), **🎵 Music** (picker: shared library + upload from
  device — **tap a library track to PREVIEW it** (expo-audio) + "Use this sound";
  **MusicTrimmer** range-slider for photo/text segments; **music volume** presets
  Mute/25/50/75/100% so tutorials can duck music under narration), a **creator-set
  price** (Free / Paid + amount field; kind-aware floor — photos 2,000, else 5,000,
  fetched from `/content/pricing`; `PriceControls` in StudioScreen), post.
  Text composer is **WYSIWYG** (type on a gradient/image background) with a style
  strip (12 backgrounds + admin image backgrounds, 7 fonts, 6 colours, align,
  bold) + music.
- **Feed playback** — `FeedItemView` plays a post's music over the media
  (`expo-audio`) at `item.musicVolume` (0..100, default 100): video caps music to
  the clip; photo/text loops the chosen segment; pause pauses both. **The video's
  own audio is now kept (not muted)** so music layers UNDER narration — the
  tutorial fix. (A future "mute original audio" toggle would restore the old
  music-replaces-clip behaviour for music-video posts.)
- **Comments** — `CommentsSheet`: safe-area bottom (clears nav bar), per-comment
  like heart, threaded replies with a "Replying to @x" banner, avatars.
- **Search** — `SearchScreen`: debounced, grouped results; creator→profile,
  post/comment→PostViewer, sounds shown (not yet tappable).
- **Admin** — `AdminScreen` (own Profile → "Admin", only if `isAdmin`): upload
  catalog sounds + text backgrounds (long-press to remove).
- **Profile, Inbox/DMs, ErrorBoundary** — unchanged from prior.

**Building the APK.** This session's app changes are **JS-only — no new native
modules** (720p uses an existing `expo-camera` prop; gallery-reject uses existing
`expo-image-picker`; music volume/preview use existing `expo-audio`). So a rebuild
just carries the new JS; it needs the same native base as the prior build
(`@shopify/react-native-skia`, `react-native-reanimated`/`-worklets`, `expo-audio`,
`expo-document-picker`, `expo-asset`, `expo-linear-gradient`, `expo-dev-client`).
```
cd /d D:\MidPay\app
set "NODE_OPTIONS=--tls-max-v1.2"
npx eas-cli build -p android --profile preview
```
(`development` profile also exists — red-screens JS errors; use it if debugging a
native crash. Download tip: phone over mobile data, or disable Chrome QUIC — the
eascdn download resets otherwise.)

**Owner account** — `0770546489` (stored `+256770546489`), handle `user_f15f85d8`,
**already `is_admin=1`** (in-app Admin button works). The **staff console** (§5a)
is separate: log in at `/console` as `kissakian@gmail.com` (super_admin, no TOTP
yet). To grant in-app admin to another number:
`wrangler d1 execute midpay --remote --command "UPDATE users SET is_admin=1 WHERE phone='+2567XXXXXXXX'"`.

---

## 5a. Admin web console — DONE and deployed

The `/admin/*` API now has a UI: a **self-contained single-page console** served
by the Worker at **https://midpay-backend.midpay.workers.dev/console**.

- **File:** [`src/http/console.html`](src/http/console.html) — one HTML file
  (inline CSS + vanilla JS, no build step, no external deps/CDN). Imported as a
  text module (`wrangler.toml` `[[rules]] type="Text"` + `src/html-modules.d.ts`)
  and served via `app.get("/console", …)` in [`src/http/app.ts`](src/http/app.ts).
- **Auth:** logs in through `POST /admin/auth/login` (email + password, reveals a
  TOTP field on `totp_required`); stores the admin JWT in `localStorage`;
  re-validates via `/admin/me` on load.
- **Tabs:** Dashboard (analytics self-funding/revenue/by-type/leaderboards +
  wallet float), Moderation (report queue + resolve, content
  quarantine/restore/remove, live kill-switch), Creators (**find by @handle /
  phone / creator-id** + suspend/ban/reinstate/verify), Config (effective values
  + inline edit + history), Payouts (float, build/approve/execute batches +
  per-batch payouts), Account (change password, enable/disable TOTP 2FA).
- **Creator lookup:** `GET /admin/creators/lookup?q=` (moderator role) resolves a
  `@handle` or phone → `{ user, creator }` (user first, since creators are 1:1
  with users; `creator` is null when the account exists but isn't a creator).
  Registered BEFORE `/creators/:id` so the param route doesn't swallow it.
  `CreatorAdminService.lookup` (now also injected with `UserRepository`).
- **Existing Super Admin:** `kissakian@gmail.com` (role `super_admin`, TOTP not
  yet enabled). Use it to log in at `/console`.
- **Why a web console, not in-app:** the admin API is a *separate* auth world
  (email+password+TOTP, RBAC) — wrong fit for the phone-login mobile app.
- Verified: page serves 200 text/html; boots with no JS errors; login error path
  works end-to-end (wrong creds → "Wrong email or password"). Authenticated views
  are wired to the real endpoints (couldn't drive them here — no console password).

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
- ~~Admin web console UI~~ — **DONE** (§5a), incl. creator lookup by
  @handle/phone/creator-id. Follow-ups if wanted: audit-log viewer, and a
  moderation deep-link from a reported target to its content/creator.
- **Search follow-ups** — sound results aren't tappable (no "posts using this
  sound" screen); comment match is a substring (the "3 words" was simplified).
- **Music follow-ups** — music **volume DONE** (per-post `musicVolume`, ducks
  under narration). Remaining: "original sound" extracted from a video's own
  audio; per-segment trim on video music (`musicEndMs` wired but video uses
  cap-to-clip); an optional **"mute original audio" toggle** (offered to owner)
  to restore music-replaces-clip for music-video posts.
- **T&C — record acceptance server-side.** Signup now shows + gates on a Terms
  modal, but acceptance is client-only. For enforceability, add
  `users.termsVersion`/`termsAcceptedAt` and have `POST /auth/signup` accept the
  version. Terms text ([`app/src/terms.ts`](app/src/terms.ts)) is a DRAFT from
  the brief's economics — have a Ugandan lawyer review before launch.
- **Free-video cap — DONE** (§4/§8): 100 min/creator, enforced + verified. Not
  yet built (the rest of §4.5.3): per-standing multipliers, free-upload rate
  limit — add only if abuse shows up. `showRemaining` allowance in the create UI
  was offered but not built; wire `/content/allowance`-style read if wanted.
- **720p cap — DONE** (§8): camera records 720p; gallery videos >720p rejected.
  Optional upgrade: add a transcode service to *downscale* instead of reject.
- **T&C — record acceptance server-side (still pending, see above).**
- **Polish backlog** — locked-paid-video poster; pull-to-refresh niceties;
  surface "free minutes remaining" to creators in Studio.

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
- **Open signup** — no approval/KYC gate to post ([[open-signup-model]]). BUT
  free video is **capped at 100 min/creator** (reversed the earlier "unlimited",
  2026-07-25, for launch budget); **paid videos unlimited**.
- **Price floors are floors, not caps** — paid **photos ≥ 2,000**, paid
  **videos/text ≥ 5,000**; creators may set any higher price. 70/30 recorded
  split applies at any price (§3.2). Live floor scales with duration (§3.3).
- **Max quality = 720p.** Camera records at 720p; gallery videos above 720p are
  rejected (no server transcode to downscale). Allowed: 720/480/360 and below.
- **Music does NOT replace the clip's own audio** — it layers UNDER it at the
  creator-set `musicVolume`, so tutorial narration stays audible (2026-07-26).
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
  http/console.html            admin web console SPA (served at /console; §5a)
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
  drizzle/migrations/          0000–0009 (all applied remote)

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
                               backgrounds, search, comments, getPricing…)
  auth.tsx                     session/token context (login/signup password)
  terms.ts                     T&C draft + TERMS_VERSION (shown at signup)
```

---

## 10. Memory pointers

[[midpay-backend-status]] · [[open-signup-model]] · [[node-tls13-reset-workaround]]
· [[stage2-live-filters-deferred]] · [[music-feature-design]] · [[in-app-admin]]
· [[admin-web-console]]
