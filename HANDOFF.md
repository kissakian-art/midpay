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
  WYSIWYG preview) was evaluated and DEFERRED (2026-07-24)** — VisionCamera v5
  can't record filtered video yet, so the live-preview win would be photo-only;
  not worth the bleeding-edge risk for a video-first app. See §6.
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

### Text overlays — SHIPPED 2026-07-24 (needs device test)

TikTok-style text-on-media, composed **at playback** (never baked into the file —
sidesteps the video-encoder wall that blocked filtered video).
- **Backend (deployed):** nullable `overlays` JSON column on `content`
  (`text({mode:"json"}).$type<TextOverlay[]>()`); threaded through create/update +
  route `readOverlays()` which **sanitises** untrusted input (≤12 items, text
  ≤200 chars, coords/size clamped, colours hex-only). Migration
  `0002_complete_vengeance.sql` applied to remote D1; worker redeployed. Verified
  end-to-end via API round-trip (clamping confirmed).
- **App:** `components/OverlayEditor.tsx` (full-bleed COVER preview + draggable
  text boxes via PanResponder + bottom bar: text / 6 colours / Shape pill toggle /
  S·M·L size / delete). `components/TextOverlayLayer.tsx` renders them read-only
  over media in `FeedItemView` (covers PostViewer). Coords normalized (0..1,
  top-left) so editor/feed match. tsc + `expo export` clean.
- **NEEDS ON-DEVICE TEST:** drag + render can't be verified remotely. Build a dev
  or preview APK, add text to a photo/video, position it, post, confirm it shows
  in the feed in the same spot. **Also flag:** editor uses a COVER preview to
  match the feed; on very different aspect ratios positions may drift slightly.

### Music on media — v1 SHIPPED 2026-07-24 (needs device test)

Compose-at-playback (never muxed into the file), same pattern as overlays.
- **Backend (deployed):** `tracks` table (owner, source device|catalog, title,
  artist, r2Key, isPublic); `content.musicTrackId` + `musicStartMs`.
  `MusicRepository`/`MusicService`; routes under `/music`: `GET /tracks` (public
  library + search, optional-auth surfaces own), `GET /tracks/:id/audio` (public,
  Range-enabled), `POST /tracks` + `PUT /tracks/:id/audio` (auth). Threaded music
  into content create/update + feed selects. Migration `0003_wild_expediter.sql`
  applied to remote D1; deployed. Verified end-to-end via API (upload→list→
  attach→stream→persist all confirmed).
- **App:** new deps `expo-audio` + `expo-document-picker` (+ `expo-asset` peer —
  REQUIRED, app crashes without it). `components/MusicPicker.tsx` (search shared
  library + "Upload from device" via DocumentPicker → createTrack → upload →
  auto-select). Studio review has a 🎵 Music button. `FeedItemView` plays the
  track over the media via `useAudioPlayer` (loops, syncs to the active cell,
  **mutes the original video audio** when music is attached).
- **NEEDS ON-DEVICE TEST + NEW BUILD** (native modules → rebuild required; test
  alongside overlays). Pick/upload a sound, post, confirm it plays in the feed.
- **v1 sources:** device audio + shared public library (= reuse of others'
  uploads, source #3). **Deferred:** admin-curated catalog UI (owner upload as
  `source:catalog`; the service already supports it, just needs an admin-gated
  route + UI), "original sound" extracted from a video's own audio, and
  trim/volume UI (`musicStartMs` is wired end-to-end but the picker sends 0).
  See [[music-feature-design]].

Service providers (Flutterwave/SMS) remain on hold per owner (2026-07-24).

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

**PRODUCT REQUIREMENT confirmed by the user (2026-07-24):** the camera should be
**WYSIWYG** — the filter shows *live while framing/recording*, not applied as a
post-capture surprise at the review screen. "Bake after capture" (Stage 1) is
fine for gallery uploads.

### Stage 2 evaluation & DECISION — DEFERRED (2026-07-24)

Investigated the live-preview path in depth. Findings (from the installed v5
typings, not guesses):
- Live filtered preview needs **VisionCamera v5** + Skia frame processors. v5
  (`react-native-vision-camera@5.1.1`, published 2026-07-17) is a **ground-up
  rewrite** with a new output-based API (`usePhotoOutput` / `useVideoOutput` /
  `useFrameOutput`) and a `<SkiaCamera onFrame={(frame,render)=>…}>` component.
- v5 standardised on `react-native-worklets` (same as reanimated 4) — the old
  worklets-core Android conflict is a **v4** problem, not v5.
- **What v5 CAN do:** live filtered *preview* (SkiaCamera + `ColorFilter.MakeMatrix`,
  same matrices as Stage 1) and filtered *photos* via `SkiaCameraRef.takeSnapshot()`
  (returns the rendered filtered frame — true WYSIWYG, but preview-resolution).
- **What v5 CANNOT do (the blocker):** record **filtered video**. `SkiaCamera`
  exposes no recording; a video output taps the **raw** camera stream, not the
  Skia-rendered output. v4 could do this; v5's rewrite hasn't reimplemented it.

**Why deferred:** MidPay is **video-first**, so a photo-only live-preview win
doesn't justify adding ~6 bleeding-edge native modules (nitro-based, a week old,
**unproven on RN 0.86**, still stabilising). Stage 1 already applies filters to
photos; the only gap is the live preview, a nicety. Better ROI on launch-critical
work (payments go-live, SMS provider, feed polish). Also flagged: real-time GPU
frame processing is a perf question on low-end Ugandan Androids — validate before
committing the architecture.

**The 5 VisionCamera/nitro packages were uninstalled** to keep the build lean and
off RN-0.86 compile risk. Kept: `@shopify/react-native-skia@2.6.2`,
`react-native-reanimated@4.5.0`, `react-native-worklets@0.10.0` (proven to
coexist, needed when we revisit). tsc + `expo export` clean after the revert.

**REVISIT WHEN:** VisionCamera v5 (or later) supports recording the Skia-rendered
(filtered) output into video. Then the full WYSIWYG camera (preview + photo +
video + privacy face-blur) becomes worth the integration. Until then, Stage 1 is
the shipping baseline.

### Follow-up (2026-07-24): user prioritised VIDEO — verified NO on-device path

User said video is the primary content and asked to pursue filtered video. I
researched every on-device path and confirmed all are blocked on RN 0.86:
- **VisionCamera v4** (latest 4.7.3, the only line that records filtered Skia
  output) is triple-blocked: (1) needs `react-native-worklets-core`, which
  collides with reanimated 4's `react-native-worklets` (Android `WorkletsPackage`
  duplicate-class build failure); (2) 4.7.3 predates RN 0.86 / new arch → won't
  compile; (3) open Skia color-matrix filter-switch crash (#3606 — our exact case).
- **VisionCamera v5** does live preview but still cannot record filtered output.

**Conclusion:** the only reliable way to deliver filtered *video* is **server-side
filtering** — phone shows live filtered preview via v5 `SkiaCamera` while a video
output records the RAW clip (v5 supports both at once); upload raw + filterId;
server applies the colour matrix with ffmpeg. This also offloads GPU work from
low-end Ugandan phones. Cost: needs an ffmpeg transcode service (Cloudflare
Workers can't run ffmpeg) → breaks the current $0/month infra, so it's a
deliberate business decision, not a rush job. Recommended stance: keep Stage 1
shipping; build the server-side pipeline when ready, OR adopt v5 filtered
recording once it lands. Do NOT spend an EAS build on the v4 path — verified dead.

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
