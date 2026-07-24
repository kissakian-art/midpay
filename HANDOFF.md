# MidPay — Session Handoff

Living status doc for picking up work in a fresh session. Last updated after the
"post thumbnails / tap-to-play / tab-bar safe area" commit (`076998e`).

---

## 1. What this is

**MidPay** — a premium pay-per-view short-video + live platform for **Uganda**
(TikTok-like feed, but creators sell videos/photos/live tickets via Mobile
Money). Building **Phase 1**. Full spec: [`project_brief_pay_per_view_uganda.md`](project_brief_pay_per_view_uganda.md).

- **Repo:** `D:\MidPay` → GitHub **`kissakian-art/midpay`** (branch `main`, pushed).
- **Backend:** Cloudflare Workers + D1 (SQLite) + Drizzle ORM + Hono.
  Deployed live: **https://midpay-backend.midpay.workers.dev**
- **Mobile app:** Expo / React Native in **`D:\MidPay\app`**.
  Expo project **`@kissa-kian/midpay`** (projectId `ee16880d-4894-426d-a47e-898b01363ed9`).

---

## 2. Environment gotchas (READ FIRST — these bite every time)

- **The folder is `D:\MidPay`** (P-a-y). There's an unrelated `D:\MidWay` on the
  machine — if EAS ever asks "create a project for midway-backend", you're in the
  wrong folder.
- **Node networking is flaky on this network.** Node's `fetch`/undici resets TLS
  1.3 connections to Cloudflare/Expo (`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`)
  while `curl` works fine. **Fix: prefix Node tools with `NODE_OPTIONS=--tls-max-v1.2`.**
  This unblocks `wrangler deploy`, `eas build`, and `git push` (see
  [[node-tls13-reset-workaround]] memory). Router reboots also help.
- **cmd vs PowerShell:** `$env:X="y"` is PowerShell; `set "X=y"` is cmd. The
  user is usually in cmd.
- **Windows line endings:** git warns `LF will be replaced by CRLF` on commit —
  harmless.

---

## 3. Backend — DONE and deployed

Everything below is built, typechecked, deployed, and verified end-to-end
against production (D1 + R2). Source under `src/`, layered
handlers → services → repositories (see [`README.md`](README.md) for the full API table).

- **Auth** — phone OTP login/signup. `PHONE_VERIFICATION_ENABLED` admin config
  can bypass OTP in dev (any code logs in). Session = JWT.
- **Content** — CRUD + lifecycle (publish/archive/quarantine/hard-delete),
  free/paid pricing with the §3.2 floor, R2 media upload + gated download,
  **thumbnails** (`GET /content/:id/thumbnail`), global **feed** with `owned`
  decoration, **text/photo/video** kinds.
- **Live** — scheduling with the **§3.3 duration price-floor guard**; a cron
  Worker (`*/2 * * * *`) auto-terminates overrun streams.
- **Payments** — Flutterwave checkout + webhook settlement into the ledger &
  wallets. **Runs in SIMULATED mode** until real keys are set (checkout returns
  `simulated:true`; settle by POSTing the webhook yourself / `devSettle`).
- **Payouts** — "Payout Fridays" batch build/approve/execute, 0.5% withdrawal
  duty, float monitor. Payouts go to the **registration phone number** (no
  separate payout number — Betpawa-style).
- **Admin console** (RBAC + audit log): config editor (versioned platform_config
  that drives runtime logic), analytics (revenue/self-funding), moderation
  (reports, quarantine/remove, live kill-switch), creator suspend/ban/verify,
  password change + **TOTP 2FA**. Bootstrap first admin at `POST /admin/bootstrap`.
- **Social** — follows (+ TikTok-style follow badge data), likes, threaded
  comments, 1:1 DMs/inbox with unread counts.
- **Profiles** — editable display name + bio, **profile pictures** (R2), and
  **claimable unique `@usernames`** (case-insensitive, reserved list, live
  availability check, race-safe via the unique index).

**Admin test account (local/dev D1 only):** `owner@midpay.local` — password was
rotated during testing; if unknown, bootstrap a fresh one or reset via D1.

---

## 4. Mobile app — DONE (needs a rebuild to test latest)

Built and verified in the web preview where possible (the browser can't do
camera/video playback / native insets — those are confirmed on-device by the user).

- **Feed** — vertical paging, video playback, buy-to-unlock overlay, text-post
  cards, right rail (avatar + **follow "+" badge**, like, comment, DM), bolder
  tab bar with a raised **+**.
- **Studio (Create)** — camera (photo/video) with a **recording timer** + ready
  gating, the **20-filter carousel** (UI only — see §6), 3 modes
  **Camera / Upload / Text**, capture → review (plays the real video) → price →
  publish. Generates a video thumbnail on post.
- **Profile** — rich TikTok-style: avatar, name/@handle, Following·Followers·
  Likes, bio, Edit profile (photo + name + bio + username with live ✓/✕), 3-col
  post grid with covers; tapping a post opens a full-screen **PostViewer**.
- **Inbox / DMs**, **login**, an **ErrorBoundary** (shows JS errors instead of
  silently closing in release builds).

**Last APK the user built:** an earlier `preview` build. The latest commits
(profile pics, usernames, thumbnails, tap-to-play, tab-bar fix) need a **new
build**:
```
cd /d D:\MidPay\app
set "NODE_OPTIONS=--tls-max-v1.2"
npx eas-cli build -p android --profile preview
```
Download tip: use the phone over mobile data, or disable Chrome QUIC
(`chrome://flags`) — the CDN download resets otherwise.

---

## 5. NOT done / pending

- **Filters — Stage 1 (photo baking) VERIFIED on device (2026-07-24).** Colour
  filters bake into captured photos via offscreen Skia (Noir → true grayscale,
  Vivid Pop → punchier, confirmed on a real Android dev build). **Stage 2 (live
  WYSIWYG preview + video) is now the active requirement** — see §6.
- **Real credentials (need the user's accounts):**
  - **Flutterwave** — business verification in progress. When keys arrive:
    `wrangler secret put FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH`, and payments go
    from simulated → live. No code change needed.
  - **SMS/OTP provider** — pick one (recommended: Africa's Talking for UG).
    Swap `sendSms` in `src/services/auth.service.ts` (currently logs the code).
- **Live streaming video** — the realtime chat backbone exists (LiveRoom Durable
  Object); still need an **Agora or ZEGOCLOUD** account + their SDK in the app
  for the actual video, plus a live UI. Free tiers exist.
- **Admin web console UI** — the admin **API** is complete; no web front-end yet
  (brief §7 suggests React-Admin/Refine over the API).
- **Polish backlog:** feed poster image for locked paid videos; real thumbnails
  for photo posts in feed; pull-to-refresh niceties.

---

## 6. NEXT MILESTONE — Filters (the plan)

**Status:** the filter **engine is DONE and unit-tested** (19 node tests):
`app/src/studio/` — `colorMatrix.ts` (composable 4×5 color-matrix algebra),
`filters.ts` (all 20: 5 aesthetic + 3 privacy + 12 cinematic LUTs),
`faceBlur.ts` (never-reveal fail-safe state machine). The carousel UI shows them.

**Stage 1 (photo colour-baking) — CODE-COMPLETE, needs a device test.** Done this
session:
- Installed the native stack **together** (the fix for the old solo-Skia crash):
  `@shopify/react-native-skia@2.6.2`, `react-native-reanimated@4.5.0`,
  `react-native-worklets@0.10.0` via `expo install` (SDK-57-correct versions).
- **No `babel.config.js`** — this project is zero-config and Expo's default
  transform already applies `babel-preset-expo`, which auto-configures the
  worklets plugin on SDK 57. (A project-root babel.config.js naming
  `babel-preset-expo` actually **breaks the build**: the preset is nested under
  `expo/` and isn't resolvable from the project root, so the Metro transformer
  fails to construct — `Cannot read properties of undefined (reading
  'transformFile')`. Don't add one.)
- Rewrote `app/src/studio/skiaFilter.ts` from stub → real **offscreen** bake:
  `Skia.Data.fromURI` → `MakeImageFromEncoded` → `Surface.MakeOffscreen` →
  `drawImage` with `ColorFilter.MakeMatrix(filter.matrix)` → `makeImageSnapshot`
  → `encodeToBytes(JPEG,92)` → written to `Paths.cache` via the new
  `expo-file-system` `File` API → returns the new `file://` uri.
  Colour filters bake; **Original + privacy filters pass through** (privacy face
  detection is Stage 2). Skia is **lazy-required inside try/catch** so a missing
  native module or any failure degrades to unfiltered passthrough — the Studio
  screen can't be crashed by the filter path.
- `tsc --noEmit` clean; `expo-doctor` clean except pre-existing patch/minor drift
  on unrelated packages (expo/expo-constants/expo-image-picker/expo-video/
  react-native-screens — not touched this session).

**To verify Stage 1 (user, on device):** build a **development** client (NOT
preview — a dev build red-screens instead of silently closing), install it, open
Studio → Camera, pick a cinematic/aesthetic filter, take a **photo**, and confirm
the review + published image is colour-graded. Video is still unfiltered until
Stage 2.
```
cd /d D:\MidPay\app
set "NODE_OPTIONS=--tls-max-v1.2"
npx eas-cli build -p android --profile development
```

**What's still missing:** live filtered *preview* and *video* baking + the 3
privacy face-blur filters — all **Stage 2** (VisionCamera + Skia frame processors
+ ML Kit face detector), unchanged from below.

**PRODUCT REQUIREMENT confirmed by the user (2026-07-24):** the camera must be
**WYSIWYG** — the filter shows *live while framing/recording*, not applied as a
post-capture surprise at the review screen. "Bake after capture" (Stage 1) is
only acceptable for gallery uploads. This makes Stage 2 (live preview) required,
not optional, for the camera path. The Stage-1 native stack
(Skia+reanimated+worklets) is proven to coexist on-device, so the main new risk
in Stage 2 is adding react-native-vision-camera itself.

**Why it's hard / why it's not done yet:**
- `expo-camera` (current camera) renders a **native preview JS can't touch** — it
  physically cannot do live filters. This is architectural, not a small fix.
- The real path needs a **GPU pipeline**: `react-native-vision-camera` v5 +
  **Skia frame processors** + `react-native-reanimated` + `react-native-worklets`
  + `react-native-vision-camera-face-detector` (ML Kit). ~6 interlocking
  bleeding-edge native libs (Nitro modules) + a babel plugin.
- **Skia was already removed once** because it was installed **without its peers**
  (reanimated + worklets) and hard-crashed the app on the Studio screen.
  `app/src/studio/skiaFilter.ts` is currently a **safe passthrough stub**.

**Recommended approach (staged, de-risked):**
1. **Use a `development` build, NOT `preview`.** Critical — a dev build shows a
   readable red-screen error instead of silently closing, which is how the Skia
   crash hid last time.
2. **Stage 1 — photo baking first (lower risk):** add `@shopify/react-native-skia`
   **with** `react-native-reanimated` + `react-native-worklets` **together**, add
   the babel plugin (`react-native-worklets/plugin` for reanimated 4), run
   `npx expo-doctor` (must pass), do a dev build, and re-enable `skiaFilter.ts`
   to bake the color matrix into captured **photos**. Prove the color pipeline
   works on-device before touching video.
3. **Stage 2 — live video:** add `react-native-vision-camera` + face-detector,
   replace the `expo-camera` view in `StudioScreen` with a VisionCamera + Skia
   frame processor for **live filtered preview** and **baked video**. Wire the
   tested `FaceConcealer` fail-safe to the ML Kit face boxes for the 3 privacy
   filters.
4. Keep the working `expo-camera` studio in git so revert is one command; gate
   the new pipeline so a native failure can't break the rest of the app.

**Reality check for the user:** this is a multi-build, iterate-with-device-
reports effort (the assistant can't verify native GPU output remotely), and it's
the single most complex feature in the spec. Everything else in the app is a
stable baseline to fall back to.

---

## 7. Accounts & credentials status

| Thing | Status |
|---|---|
| Cloudflare (Workers/D1/R2/DO/cron) | ✅ live, wrangler logged in on machine. R2 enabled. |
| `JWT_SECRET` | ✅ set as a Worker secret |
| Expo / EAS | ✅ `@kissa-kian/midpay` configured |
| GitHub | ✅ pushed to `kissakian-art/midpay` |
| Flutterwave keys | ⏳ user's business verification in progress |
| SMS provider | ❌ not chosen yet |
| Agora/ZEGO (live video) | ❌ not set up |
| Google Play ($25, optional) | ❌ only if Play Store distribution wanted |

**Cost note:** $0/month fixed to run at launch. Only per-use costs: Flutterwave
3% per sale, ~pennies per login SMS, live streaming free tier. See brief §6.

---

## 8. Product decisions locked in (don't re-litigate)

- **Open signup** — no approval/KYC gate to create an account or post; free
  unlimited uploads. KYC is an optional admin "verified" badge only.
  ([[open-signup-model]])
- **Payout number = registration number** (can't set a separate one).
- **`@username` is unique; display name is NOT** (two people can both be "Coach
  Emma", like TikTok).
- Live price floor (§3.3) and auto-terminate are **hard requirements** — keep them.

---

## 9. Key file map

```
Backend (src/)
  index.ts                    Worker entry + cron scheduled handler
  http/{app,container}.ts     Hono app + DI composition root
  http/routes/*               auth, users, creators, content, live, payments, reports, admin, messages
  services/*                  business logic (pricing.ts = §3.2/§3.3 money rules)
  services/admin/*            admin auth, moderation, config, analytics, creator-admin
  repositories/*              data access (Drizzle)
  realtime/live-room.ts       LiveRoom Durable Object (chat/reactions/presence)
  jobs/terminate-overrun-lives.ts   §3.3 cron
  db/schema/*                 Drizzle schema (portable: UUID PKs, standard SQL)

App (app/src/)
  screens/*                   Feed, Studio, UserProfile, PostViewer, Inbox, Conversation, Login
  components/*                FeedItemView, CommentsSheet, Avatar, CapturePreview, ErrorBoundary
  studio/*                    filter ENGINE (colorMatrix, filters, faceBlur) + skiaFilter STUB
  api.ts                      typed backend client
  auth.tsx                    session/token context
```

Deploy backend: `cd D:\MidPay && NODE_OPTIONS=--tls-max-v1.2 npx wrangler deploy`
Verify UI locally: web preview via the Browser-pane preview tools (camera/video
won't work there — logic/layout only).

---

## 10. Working style that's been effective

- Build → typecheck → **verify against production/real flow** → commit → push.
- The user tests each APK on a real Android and reports what's broken; fix that
  loop. Be honest about what can't be verified remotely (native camera, insets,
  video playback, GPU).
- Commit granularly with detailed messages; push after each meaningful chunk.
