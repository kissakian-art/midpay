# PROJECT BRIEF: PREMIUM SHORT-FORM VIDEO & LIVE PLATFORM
### Technical & Operational Architecture Blueprint

**Target Market:** Uganda 
**Monetization Mode:** Premium Pay-Per-View
**Date:** July 2026

> **Revision v7 note (developer-ready):** This version is scoped for the build team to start coding. It adds the **Platform Administration Console (§7)** — the web-based operational cockpit the platform owner runs the business from (creator approvals, moderation, payouts, pricing thresholds, analytics), a **Phase-1 deliverable**; locks in the **Backend & Database (§2.4): Cloudflare D1 + Workers**, chosen for flat, predictable cost as users grow and built for portability so a future move to self-hosted Postgres is low-friction; and adds **§4.5 Creator Content Management** — free/paid pricing status (editable anytime), no cap on paid content, admin-tunable governance of free content, creator delete/archive tools, and a fair deletion policy that preserves paid buyers' access and always retains financial records. The headline rule is the **Live Duration-Based Price Floor (§3.3)** — a loss-prevention guard that ties the minimum live ticket price to the declared stream length (≥5,000 UGX per hour), so a long live can never push the platform into a loss while both creator and platform keep earning. Live streaming is delivered with a **standard streaming provider on its free tier at launch (Phase 1)**; the zero-egress split-HLS design is an **optional Phase-2 cost optimization for when the app is earning** (§2.3) — developers do not need to build it first. Retained from earlier revisions: free on-device face blur for anonymity (§4.3), 5,000 UGX as a minimum floor not a cap, 5-minute clip cap, and the financial notes in §6.
>
> **Build phasing (what to build now vs later):** *Phase 1 (launch, near-zero cost):* React Native/Flutter app, **Cloudflare D1 + Workers backend (§2.4)**, Cloudflare R2 free tier, on-device encoding, Flutterwave (pay-per-transaction), a standard streaming provider's free tier, free face blur, the §3.3 price guard, and the **admin console you operate the business from (§7)**. *Phase 2 (reinvest once earning):* split-HLS streaming, paid AR masks, higher storage tiers, and the richer admin analytics/automation (§7). Nothing in Phase 2 is required to launch or to be profitable.
>
> *All UGX↔USD figures assume a reference rate of ~3,700 UGX per USD (July 2026); confirm the live rate before financial planning.*

---

## 1. Executive Summary & Strategic Edge

This document establishes the technical foundations and architectural constraints for a localized, high-performance mobile application tailored explicitly to the Ugandan creator economy. Moving away from standard global ad-supported models, the platform introduces a decentralized micro-transaction system enabling everyday local experts — such as educators, tailors, automotive mechanics, fitness professionals, and specialized entertainers — to monetize directly from their audience.

**Strategic Competitive Advantages:**

- **Built-in Marketing Flywheel:** Direct operational partnership secured with three prominent Kampala-based launch influencers. The platform utilizes a generous tiered revenue split to maximize early advocate engagement.
- **Localized Micro-Payments:** Direct infrastructural integration with Uganda's dominant cash transmission networks via native API wrappers, capturing an active market demographic currently locked out of credit card-dependent applications.
- **Optimized Architectural Footprint:** Engineered entirely around deep structural caching and zero-egress data patterns to minimize operating expenses within a high-cost mobile data environment.

---

## 2. Core Technical Architecture & Tech Stack

The application framework must minimize initial development loops while ensuring deployment parity across operating systems. The software engineering team will build utilizing the following baseline technical modules:

### 2.1 Front-End Framework

Cross-platform compilation using React Native or Flutter, yielding a single shared codebase compiled into optimized native binaries for iOS and Android. Priority must be placed on optimization for budget Android devices with restricted internal memory storage and processing boundaries. Initial compiled application download bundle size must be aggressively optimized to fall under 30 Megabytes (MB).

### 2.2 Media Processing & Zero-Egress Storage

- **Primary Storage Engine:** Implemented utilizing Cloudflare R2 rather than standard Amazon S3 tiers. This architectural choice explicitly shifts operations to a structural framework with $0.00 data transfer out (egress) fees, removing financial volatility tied to unpredictable viewer traffic.
- **Media Optimization Layer:** Video is encoded to aggressive H.265/HEVC standards, yielding highly reduced file payloads (a reference baseline of approximately 5 MB per 15 seconds of footage). Clip length is **not fixed at 15 seconds** (see §4.3); for longer clips the encoder must **step the target bitrate down** so that a full-length clip remains storage- and cache-friendly rather than scaling linearly in size.
- **On-device encoding (cost control):** Wherever the capturing device supports it (most modern Androids ship a hardware HEVC encoder), transcoding should run **on-device before upload** rather than on serverless backend processors. This eliminates server compute cost per upload and shrinks the upload payload. A serverless transcode path is retained only as a fallback for devices whose hardware encoder cannot meet the quality bar.

### 2.3 Live Streaming Video Infrastructure

**Phase 1 — Launch build (standard streaming provider, near-zero starting cost):**

Integrate a standard interactive streaming SDK — **Agora.io or ZEGOCLOUD**. These bill **per viewer, per minute** (roughly $0.004 ≈ ~15 UGX per viewer-minute at 720p), but both include a **free monthly allowance (about 10,000 minutes)**, so early live streaming costs effectively nothing while the audience is small. Broadcast resolution is capped at **480p or 720p (Standard High Definition)** to limit cost and local network overhead.

The per-viewer-minute billing is made safe — and kept profitable on every stream regardless of length or audience size — by the **Live Duration-Based Price Floor in §3.3**. That guard, not any special architecture, is what protects the platform. This standard setup is all that is required to launch and be profitable.

**Phase 2 — Optional cost optimization (build only once the app is earning):**

At larger scale, live cost can be cut dramatically with a split host/audience pipeline: keep only the host and any "on-stage" guests (1–5 people) on the metered interactive SDK, while the passive audience receives a **Low-Latency HLS (LL-HLS)** feed served from **Cloudflare R2 through the CDN at $0.00 egress** — making audience delivery essentially free no matter how many watch. Chat, reactions, and tipping ride a lightweight WebSocket channel separate from the video path. Ingest/transcode can be delivered via **LiveKit** (self-hosted, cheapest at scale) or **Cloudflare Stream Live** (fastest to ship). This adds a few seconds of latency for the audience (fine for paid one-to-many content). **This phase is a margin improvement, not a launch requirement — do not build it first.**

### 2.4 Backend & Database

- **Backend logic:** Cloudflare Workers — serverless, billed per request with no egress fees.
- **Primary datastore:** Cloudflare D1 (SQLite-based), kept in the same zero-egress Cloudflare ecosystem as R2 storage (§2.2).
- **Realtime (live chat, reactions, tipping signals):** Cloudflare Durable Objects over WebSockets — purpose-built and cheap, avoiding the per-connection realtime costs that make bundled managed backends expensive at scale.
- **Rationale:** cost stays **flat and predictable as users grow** (tens of dollars/month even at ~100k users), consolidates the whole stack under one vendor and one bill, and keeps operational overhead low. This is a Phase-1 choice.

**Data-placement discipline — keeps D1 far under its size ceiling (mandatory):** D1 is SQLite-based, with a per-database size limit (~10 GB today, and rising over time). That ceiling only becomes a concern if bulky or high-frequency data is stored in the database. To keep D1 lean for years, the following placement rules are required:

1. **D1 stores only core relational state and the financial ledger** — users, creators, content metadata, transactions, wallet balances. A ledger row is ~200 bytes, so ~10 GB ≈ **~50 million transactions** — decades of runway at launch volumes.
2. **Video and images → Cloudflare R2**, never the database.
3. **Live chat, reactions, and other high-frequency signals → Durable Objects**, never D1.
4. **View events, request logs, and raw analytics → Cloudflare Analytics Engine or R2** — store only small aggregated summaries in D1 if needed, never the raw firehose.
5. **Archive cold data:** periodically move fully-settled, old records (e.g. closed events older than N months) out to R2 cold storage so the working database stays small.

**Early-warning monitoring:** the admin console (§7.6) surfaces the live D1 database size and growth rate with an alert at ~60% of the ceiling, so any future need to archive, shard across multiple D1 databases, or migrate is visible **months in advance** — never a surprise outage. Together with the portability spec below, this makes the D1 choice low-risk and fully reversible.

**Portability requirement — protect the future self-hosted-Postgres option (mandatory):** although the platform launches on D1, the backend **must** be built so a later migration to self-hosted PostgreSQL on a VPS is a configuration-level change, not a rewrite. Developers must:

1. **Access the database only through a dialect-agnostic query layer — Drizzle ORM** (which supports both D1/SQLite *and* Postgres) or Kysely. No raw D1-binding queries scattered through the codebase.
2. Use **UUID primary keys**, not SQLite `AUTOINCREMENT`.
3. Keep to **standard, portable SQL** in all core tables — and especially the **financial/wallet ledger** tables — avoiding SQLite-only or Postgres-only features there.
4. Isolate all data access behind a **repository/service layer** so that only that layer changes on migration.
5. Manage schema with a **portable migration tool** (e.g. Drizzle Kit) able to target both dialects.

**Two supported future migration paths:**
- **Keep Workers, move only the database** — connect the existing Workers to an external Postgres on the VPS via **Cloudflare Hyperdrive**; the application/compute layer is untouched.
- **Full self-host** — move the backend to a Node service on the VPS using the same Drizzle data layer pointed at Postgres.

Data transfer at migration time (D1 export → Postgres import, e.g. via `pgloader`) is a known, low-risk process at launch-scale data volumes.

---

## 3. The Pay-Per-View Financial Ledger & Revenue Splits

The billing infrastructure handles all end-to-end customer collections directly within the application workspace, completely abstracting away out-of-app interactions like USSD text strings.

### 3.1 Internal Payment Workflows

All monetization relies on native integrations with the Flutterwave Mobile SDK, which acts as the core gateway for processing customer collections and initiating programmatic bulk payouts. For premium video unlocks and live stream admissions, the application fires secure STK Push notifications. The client inputs their mobile number, triggering an immediate, secure overlay requesting their Mobile Money PIN code directly inside the OS interface. Background webhooks immediately signal payment validation to toggle content access keys.

### 3.2 Revenue Split Models & Commission Structures

To balance operational platform sustainability, server maintenance, and creator retention, the application applies two decoupled financial strategies based on the operational cost of the media asset class:

- **Recorded Premium Videos & Photos:** Structured as a strict 70/30 baseline split (70% net revenue delivered to the creator's wallet ledger, 30% retained by the platform for base support).
- **Live Broadcast Streams:** Governed by a dynamic, volume-driven escalation matrix (below) plus the **Live Duration-Based Price Floor (§3.3)**, which is the primary protection against long streams turning unprofitable. The matrix sets how the pool is shared; §3.3 guarantees the pool is always large enough to cover streaming cost.

**Pricing floor (clarified):** The **5,000 UGX figure is a minimum price floor, not a cap or a fixed price.** No content — recorded or live — may be priced below 5,000 UGX, but creators are free to set **any price at or above** this floor for a video or a live stream. **The revenue-split percentages in the matrix below apply to whatever price the creator sets**, at any ticket value; a higher price does not change the split, it simply scales the pool the split is applied to.

| Media Format | Audience / Sales Volume Tier | Creator Allocation | Platform Allocation |
|---|---|---|---|
| Recorded Media Clips | Any Volume Range | 70% | 30% |
| Live Video Broadcasts | 1 to 200 Concurrent Viewers | 60% | 40% |
| Live Video Broadcasts | 201 to 500 Concurrent Viewers | 65% | 35% |
| Live Video Broadcasts | 501+ Concurrent Viewers | 70% | 30% |

**Financial Simulation** (Phase-1 standard streaming; 1-Hour Live Stream, 350 Viewers, at the 5,000 UGX floor price — a higher creator-set price scales these figures proportionally):

- Gross Receipts: 1,750,000 UGX
- Flutterwave Collection Fee (3%): 52,500 UGX
- Net Split Pool: 1,697,500 UGX
- Creator Share (65%): 1,103,375 UGX
- Platform Share (35%): 594,125 UGX
- Streaming cost (350 viewers × 60 min × ~15 UGX/viewer-min at 720p; **~0 while within the provider's free monthly minutes**): ~315,000 UGX
- **Net Platform Project Yield: ~+279,000 UGX** net profit from a single mid-tier broadcast event. The §3.3 price guard keeps this positive as duration grows; the Phase-2 split-HLS design (§2.3) later cuts the streaming-cost line to a small fixed fee, raising net toward ~+579,000 UGX. See §6.2.

### 3.3 Live Duration-Based Price Floor (Loss-Prevention Guard) — **hard requirement**

This is the rule that guarantees a live stream can never run the platform into a loss, no matter how long it runs or how many people watch, while both the creator and the platform keep earning. It is a **required, server-enforced** control.

**Why it works (the underlying math):** at 720p, streaming costs the platform about **15 UGX per viewer per minute** (~900 UGX per viewer for a full hour). Each viewer pays one ticket, and the platform keeps ~30–40% of it. Since every viewer brings their own ticket that covers their own streaming cost, **audience size is not the risk — only stream length relative to price is.** So the ticket floor must rise with the declared length.

**The rule:**

1. **Declared duration.** When scheduling a live, the creator declares a maximum duration, `D` (minutes).
2. **Enforced minimum price.** The system blocks any live ticket priced below:

   > `minLivePrice = LIVE_MIN_PRICE_PER_HOUR × ceil(D / 60)`
   > with **`LIVE_MIN_PRICE_PER_HOUR = 5,000 UGX`** (a server-side config constant).

   Examples: up to 60 min → **min 5,000 UGX**; 61–120 min → **min 10,000 UGX**; 121–180 min → **min 15,000 UGX**. The creator may price *above* this; they may not go below it.
3. **Runtime cap.** The stream **auto-terminates at `D` plus a short grace period (e.g. 5 minutes).** A creator cannot overrun the duration their price was validated against; to stream longer they schedule a longer (higher-priced) event.
4. **Owner-tunable safety buffer.** `LIVE_MIN_PRICE_PER_HOUR` is a config value the platform owner controls. Raw break-even at the worst-case 30% split is ~3,000 UGX/hour; the 5,000 default builds in roughly a **1.6× cushion** against exchange-rate moves or provider price rises. Also expose `STREAMING_COST_PER_VIEWER_MINUTE` (default ~15 UGX) as config so the guard can be recalculated if provider rates change.

**Guarantee:** with this guard active, `platform_share ≥ streaming_cost` holds for every viewer on every stream, so live is profitable by construction. (Worked example: a 3-hour, 600-viewer stream is forced to a ≥15,000 UGX ticket → platform nets **~+999,000 UGX** instead of the **~−690,000 UGX loss** the same event would produce if it were allowed at the 5,000 floor. See §6.2.)

---

## 4. Critical Technical Constraints & Local Optimization

To successfully launch within the regional constraints of the East African digital ecosystem, development teams must strictly comply with the following product requirements:

### 4.1 Client-Side Media Caching (Zero-Rebill Loop)

The engineering team must deploy an aggressive local cache manager within the client-side media container. Upon initial viewing of a video stream, the data block is concurrently written to the phone's local persistent storage sandbox. If the viewer navigates back to the asset, the video player streams the file locally from the cache directory. This guarantees that subsequent playback calls incur exactly $0.00 in backend data fees while dramatically preserving the customer's mobile data bundle.

### 4.2 Unified Live Ticket Architecture (Late Arrivals)

Live stream event pricing is **fixed per event at the price the creator sets** and does not vary by arrival time; that price must satisfy the **Live Duration-Based Price Floor (§3.3)** for the creator's declared duration. Late entrants pay that same creator-set admission price regardless of elapsed time. The declared duration is surfaced to buyers as part of the ticket's value, and the stream **auto-terminates at the declared duration plus a short grace period** (§3.3). To optimize perceived customer value, the application records the broadcast server-side; upon closure it is written to the Cloudflare R2 archive, linked to the event ID in the database, and made available as a replay. Users who entered mid-stream can access the complete historical replay directly through the creator's profile catalog.

### 4.3 Video Creation, Length Cap & Filter / AR UI Requirement

**Clip length:** Clips are **not restricted to 15 seconds.** To serve longer-form content — tutorials from educators, tailors, mechanics, and fitness professionals — the platform supports a **recommended maximum clip length of 5 minutes (300 seconds).** To keep this consistent with the platform's cost and efficiency goals, the upload encoder must apply a **length-aware bitrate ladder**: short clips retain the high-quality ~5 MB/15 s baseline, while longer clips step down to a lower target bitrate so a full 5-minute clip stays practical to store, transfer, and cache on budget devices rather than scaling linearly toward ~100 MB.

**Studio filters & privacy tools:** The studio camera layout houses a curated set of local, GPU-accelerated production adjustments. Creator anonymity — control over whether and how a creator's face is shown — is treated as a **first-class, free feature** delivered through on-device face blur/pixelation rather than a paid AR SDK. The curated set is organized as follows:

- **Core Aesthetic Enhancements (5 filters):** Native algorithms for low-light digital exposure optimization, discrete blemish smoothing, teeth whitening, and structural lens-distortion compensation.
- **Privacy / Anonymity — Face Blur & Pixelation (3 filters):** Real-time face concealment (Gaussian blur, mosaic/pixelate, and block-bar) driven by **free on-device face detection (Google ML Kit or MediaPipe)** plus a GPU shader — no paid licensing and negligible bundle weight. Implementation must **over-size the concealed region and temporally smooth tracking**, with a **fail-safe** that blurs the whole frame (or the last-known region) if tracking drops a frame, so a tracking hiccup can never reveal identity. For recorded clips the concealment is **baked irreversibly into the encode**; for live it is applied on-device before the frame reaches the ingest tier.
- **Cinematic Styling Adjustments (12 filters):** Hardcoded local Lookup Tables (LUTs) providing professional grading choices (e.g. Warm Golden Hour, Sharp Corporate, Cinematic Teal/Orange, Matte Black & White). Because LUTs are lightweight (a few kilobytes each), they avoid external server downloads during content creation.

**Deferred — entertainment AR masks (optional add-on):** Snapchat-style 3D AR face masks (DeepAR / Banuba native SDKs) serve *entertainment/stylization*, a distinct need from privacy. Because those SDKs are licensed (recurring per-user cost) and heavy relative to the <30 MB bundle target, they are **deferred as an optional, on-demand-downloaded premium module** to be added only once demand is proven — they are not part of the base install.

### 4.4 Content Protection, Digital Piracy & Download Protocols

- **Public/Free Content:** Full gallery download access enabled. The app wrapper must dynamically execute client-side watermarking upon file compilation, embedding the corporate platform logo and creator's unique handle to drive organic acquisition via external redistribution (e.g. WhatsApp Status sharing).
- **Premium/Paywalled Media:** The export/download engine must be completely stripped out. The front-end mobile code must integrate hard framework secure layers (`WindowManager.LayoutParams.FLAG_SECURE` on Android and structural `isSecureTextEntry` layers on iOS) to immediately black out the media layer if screen capturing or external video recording extensions are active.

### 4.5 Creator Content Management, Pricing Status & Deletion Policy

Creators own and manage their own catalogue. The guiding principle: **paid content is uncapped** (every paid video earns and pays its own way), while **free content is governed** (it earns nothing directly and is abuse-prone), and creators get real tools to curate — including removing content they've outgrown.

#### 4.5.1 Pricing status (free vs. paid) — creator-controlled and editable
- Every video is either **free** or **paid**. The creator sets this **at upload or changes it later**, and sets the price (subject to the §3.2 floor) for paid videos.
- **Protection follows the current status automatically** (§4.4): *free* → download enabled + client-side watermark; *paid* → download engine stripped + `FLAG_SECURE` / `isSecureTextEntry`. When a creator flips a video's status, the app applies the new protection profile **going forward**.
- **Free → paid:** already-distributed free copies cannot be recalled; gating applies to **future viewers only**. This must be surfaced to the creator at the moment of switching.
- **Paid → free:** existing buyers are **not refunded** (they had access while it had value); show the creator a **clear warning** before confirming.

#### 4.5.2 No cap on paid content
Paid videos are **uncapped**. Each is a revenue stream (the platform takes its cut) and is self-limiting (junk won't sell), so there is no cost, storage, or quality reason to cap them. A prolific paid creator is a top asset, not a burden.

#### 4.5.3 Free-content governance (abuse control — admin-configurable)
Free videos earn no direct revenue and are downloadable, so they are governed to stop the platform being used as free hosting or spam — while staying generous enough not to choke the reach funnel:
- **Generous free-content allowance**, measured in **free minutes** (default starting point ~100 minutes / ~30 clips), set high enough that a normal creator never notices it.
- **Upload rate limit** on free uploads (e.g. per day) as the primary anti-spam lever.
- **Allowance scaled by account standing:** smaller for new/unverified accounts, larger for verified or active creators (especially those also posting paid content).
- **All of these thresholds are admin-console configuration values (§7.2), not hardcoded**, and are expected to be tuned after launch once real behaviour is observed.

#### 4.5.4 Content management tools
Creators can, over their own content:
- **Delete**, **Archive / Unpublish** (hide from public profile and new sales — **reversible**), and **Bulk-manage** (select many at once, for cleaning up old content they no longer remember making).
- Archive/Unpublish is positioned as the gentle default for "I've outgrown this," since it's reversible and preserves buyer access.

#### 4.5.5 Deletion policy (paid-content fairness + record retention)
- **Unpublish** is the soft default: removes the video from new sales and hides it from the profile, but **everyone who already paid keeps their access.** No refunds required.
- **Hard-delete** is a separate, heavier action behind an explicit warning; if the video had paying buyers, the warning must state that **those buyers will permanently lose access** before the creator confirms.
- **Financial and sales records are always retained** (ledger entries, payout history) even after the media itself is deleted — **delete the video, never the transaction history** (required for payouts, tax, and dispute resolution — see §5, §6.6).

---

## 5. Compliance, Operations & Launch Sequence

1. **Regulatory Alignment:** Prior to public production builds, corporate counsel must finalize terms of service agreements assigning intellectual property liabilities to authors and secure data handling authorization with the Uganda Communications Commission (UCC).
2. **Settlement & Float Schedules:** Payout mechanics are restricted to a structured weekly calendar (e.g. "Payout Fridays") rather than instant balance sweeping. This operational constraint safeguards system float, protects merchant wallet reserves, and enables automated batch audits to minimize outbound transfer charges.

---

## 6. Financial Viability, Unit Economics & Risk Notes

*Reference rate ~3,700 UGX/$1. Figures are planning estimates, not audited projections.*

### 6.1 Two business lines, two cost profiles

The platform is really two businesses with very different economics, and they should be reasoned about separately:

- **Recorded video/photo — the cash cow.** After a one-time encode (ideally on-device, §2.2), content sits in R2 (zero egress) and is client-cached after first view. Platform margin is near-pure: at the 5,000 UGX floor the platform's 30% share is **~1,455 UGX (~$0.39) per sale at effectively zero marginal cost.** Because the v2 change lets creators price above the floor, platform revenue scales with price while marginal cost stays ~zero — this line is what makes the platform self-funding.
- **Live streaming — kept profitable by the duration guard (§3.3).** Interactive streaming bills ~15 UGX per viewer-minute, so a flat ticket could lose money on an over-long stream. The **Live Duration-Based Price Floor** prevents this by forcing the ticket floor to scale with declared length (≥5,000 UGX/hour) and auto-ending the stream at that length. With the guard in place the platform's cut always exceeds streaming cost on every viewer — so **live is profitable using nothing more than a standard streaming provider on its free tier.** The Phase-2 split-HLS design (§2.3) reduces streaming cost further but is **not required** for profitability.

### 6.2 Why live streaming stays profitable (the guard, then the optional optimization)

Each viewer brings one ticket that covers their own streaming cost, so **audience size is not the risk — only stream length vs. price is.** The §3.3 guard closes that gap by pricing per hour. The table shows the same two events (a) unguarded at the flat 5,000 floor — the failure mode — and (b) guarded per §3.3:

| Scenario | (a) Unguarded flat 5,000 ticket | (b) Guarded per §3.3 (Phase-1 standard streaming) |
|---|---|---|
| 1 hr, 350 viewers | ticket 5,000 → **~+279,000 UGX** | ticket 5,000 → **~+279,000 UGX** |
| 3 hr, 600 viewers (stress) | ticket 5,000 → **~−690,000 UGX (loss)** | ticket forced to ≥15,000 → **~+999,000 UGX** |

The stress row is the point: the guard turns the event that *would* have lost ~690,000 UGX into a ~999,000 UGX profit — **on the standard streaming setup alone, no special architecture needed.** Layering the Phase-2 split-HLS design on top later cuts the streaming-cost line to a small fixed fee, pushing these figures higher still (e.g. the 1-hour event rises toward ~+579,000 UGX). Live is a second profit center, and it is safe from day one.

### 6.3 Self-funding threshold (illustrative)

Operating cost per transaction is dominated by the Flutterwave 3% (taken from the pool) plus negligible R2 storage; delivery is ~zero-egress. The binding variable is **volume**, not per-unit margin. As a rough sizing: covering a lean **~$3,000/month (~11.1M UGX)** of fixed opex requires on the order of **~7,600 floor-price recorded sales/month (~250/day)** — fewer if average price sits above the floor, or if live and tipping contribute. This is achievable for a Kampala launch but is the real make-or-break metric to track from day one.

### 6.4 Revenue upside levers (recommended)

- **Live tipping / gifting** over the out-of-band engagement channel (§2.3) — highest-margin revenue in the model, since the stream already exists and gifts add ~zero infra cost.
- **Creator subscriptions / bundles** — recurring revenue smooths float and payout planning.
- **Lower the *recorded* floor (keep the live floor).** 5,000 UGX (~$1.35) may suppress impulse buys; because recorded margin is near-pure, a 1,000–2,000 UGX recorded floor could lift total platform revenue through volume.
- **Trackable share links** on the watermarked free content (§4.4) to make organic WhatsApp redistribution a measurable acquisition channel.

### 6.5 Cost-cutting summary

1. **Start on free tiers** (Phase 1): streaming-provider free minutes, Cloudflare R2 free tier, Flutterwave's pay-per-transaction model — near-zero cost to launch.
2. **On-device HEVC encoding** (§2.2) — removes serverless transcode compute and shrinks uploads.
3. **Zero-egress HLS audience tier** (§2.3, **Phase 2**) — the single largest live-cost reduction once volume outgrows the free tier.
4. **LiveKit (self-host) or Cloudflare Stream Live** for ingest/transcode at scale (**Phase 2**) — shop per-minute rates and negotiate committed-use.
5. **R2 lifecycle rules** — auto-expire or downgrade stale live replays to control silent storage growth.
6. **Payout batching + minimum payout threshold** (§5) — and budget for Uganda's **0.5% mobile-money withdrawal excise duty** on outbound transfers.
7. **Free face blur instead of paid AR SDK** (§4.3), with the AR module deferred and downloaded on demand to protect the <30 MB bundle.

### 6.6 Risks & compliance gaps to close before launch

- **Willingness to pay** at the 5,000 floor is the primary demand risk; validate with the three launch influencers before full build.
- **Regulatory scope beyond UCC:** confirm obligations under Uganda's **Data Protection and Privacy Act (2019)**, **URA tax registration**, and any digital-service/withholding tax treatment with local counsel. *(Flagged for counsel — not legal advice.)*
- **Refund / fraud policy:** `FLAG_SECURE` (§4.4) stops screen capture but not a second phone filming the screen; a "buy → record → refund" policy is required to protect margin.
- **Float / liquidity:** weekly "Payout Fridays" (§5) mitigate this; monitor merchant wallet reserves against payout obligations.
- **Latency trade-off (Phase 2 only):** if/when the split-HLS audience tier is adopted, it adds a few seconds of latency; genuine real-time interaction is preserved via the on-stage tier and the out-of-band chat/tipping channel. Phase-1 standard streaming has no such trade-off.

---

## 7. Platform Administration Console (Admin Panel)

The admin console is the **web-based operational cockpit** the platform owner and staff use to run the business. It is a **separate web application** (e.g. React / Next.js) that talks to the same backend API as the mobile app, under admin-scoped authentication — it is **not** part of the mobile bundle. It is a **Phase-1 deliverable**: the platform cannot be operated safely on day one without it (someone must approve creators, moderate content, and release payouts).

**Cost-conscious build note:** to keep Phase-1 spend low, the first version of the console can be assembled quickly on a low-code admin-UI framework (e.g. **React-Admin or Refine**, which are open-source, or a hosted builder like **Retool**) over the existing API, then graduated to a fully custom UI in Phase 2. *(These are tools for building admin screens only — they are independent of your backend/database choice, see §2.4.)* Build the *must-have* modules (7.2 config, 7.3 creator approvals, 7.4 moderation, 7.5 payouts) first; the analytics depth in 7.7 and automation can follow once the app is earning.

### 7.1 Access, Roles & Security
- **Role-based access control (RBAC):** Super Admin (owner), Finance, Moderator, Support, and Read-only Analyst — each seeing only what its role needs.
- **Mandatory 2FA** for every admin account; optional IP allowlist for finance actions.
- **Immutable audit log:** every admin action — especially config changes and money movements — is recorded with who/what/when and is non-editable.

### 7.2 Configuration & Business Rules (the levers you control)
- **Pricing thresholds:** recorded-content floor, `LIVE_MIN_PRICE_PER_HOUR`, `STREAMING_COST_PER_VIEWER_MINUTE`, and optional maximum prices — all editable here rather than hardcoded (§3.3).
- **Revenue-split matrix editor:** adjust the tier percentages and viewer bands (§3.2), plus **per-creator overrides** (e.g. custom splits for the three launch influencers).
- **Content rules:** clip-length cap, live resolution cap, auto-termination grace period, the free-tier streaming-minute budget with alert thresholds, and the **free-content governance settings (§4.5.3)** — free-content allowance (free-minutes), free-upload rate limit, and the per-account-standing multipliers.
- **Feature flags / phase toggles:** turn modules on/off (paid AR masks, live tipping, referral links) and manage the studio filter/LUT catalogue.
- All changes are **versioned and effective-dated** so you can see what the rules were at any point in time.

### 7.3 Creator Management
- **Onboarding / KYC queue:** approve or reject new creators, verify ID and their mobile-money payout account.
- **Creator directory:** search and filter by status (active / suspended / banned), earnings, or content volume.
- **Per-creator controls:** custom revenue split, verification badge, payout details, full content list, earnings history, and strike/warning record.
- **Suspend / ban / reinstate** with a required reason, all captured in the audit log.

### 7.4 Content Moderation
- **Review queue** for reported or flagged uploads (with optional pre-publish moderation for new creators).
- **Live monitoring:** a list of currently-active streams with preview, concurrent-viewer count, and a **one-click kill switch** to end an abusive stream immediately.
- **Takedown tools:** remove or quarantine content, notify the creator, and run a DMCA / UCC-style takedown workflow.
- **Piracy handling:** review flagged external redistributions and manage the paywalled-media protection policy (§4.4).

### 7.5 Finance, Wallets & Payouts
- **Platform revenue dashboard:** gross receipts, Flutterwave fees, and net platform earnings, broken down by content type and time period.
- **Creator wallet ledgers:** per-creator balances, full transaction history, and manual holds.
- **Payout management ("Payout Fridays"):** view the pending weekly batch, apply the minimum-payout threshold, approve or hold individual creators, and execute the batch via Flutterwave bulk transfer — with the **0.5% mobile-money withdrawal duty** shown per transfer (§6.5).
- **Float / reserve monitor:** merchant wallet balance vs. outstanding creator obligations, with low-float alerts so you never promise money you can't send.
- **Refunds & disputes:** process refunds, review fraud flags (the "buy → record → refund" pattern, §6.6), and handle chargebacks.
- **Reconciliation:** match Flutterwave settlement reports against the internal ledger and export for accounting.

### 7.6 Live Events & Streaming-Cost Control
- **Events calendar:** scheduled and active lives, each showing ticket price, declared duration, and §3.3 guard status.
- **Per-event economics:** viewers, streaming minutes consumed, cost vs. revenue, and net — live, so you can watch a stream's profitability in real time.
- **Provider usage meter:** streaming minutes used vs. the free-tier allowance this month, with a projected-overage alert *before* you start paying (Phase-1 cost safety).
- **Infrastructure health meters:** current **Cloudflare D1 database size vs. its ceiling** — with an alert at ~60% so any need to archive, shard, or migrate is seen months ahead (§2.4) — shown alongside the streaming-minutes meter as your two "approaching a limit" gauges.

### 7.7 Analytics & Reporting
- **Core KPIs:** daily/monthly active users, new signups, viewer→buyer conversion, and average revenue per user.
- **Sales analytics:** volume and revenue by content type, top creators, and top content.
- **Self-funding tracker:** actual daily sales vs. the break-even target (§6.3), so you can see at a glance whether the platform is covering its costs.
- **Retention & funnel:** cohort retention, churn, and the signup→purchase funnel; all reports exportable to CSV.

### 7.8 Support & Communications
- **User/creator lookup and account tools** (password reset, unlock, wallet adjustment with audit).
- **Dispute & ticket handling** tied to the refund tools in 7.5.
- **Broadcast messaging:** send push notifications or in-app announcements to targeted user segments.
- **Growth tools:** promo codes and **referral / share-link attribution** for the watermarked free-content channel (§6.4).

### 7.9 Compliance & Audit
- **Immutable admin audit trail** (from 7.1) exportable for review.
- **KYC record store** and **data-subject request handling** (access / deletion) for Uganda's Data Protection and Privacy Act 2019 (§6.6).
- **Regulatory exports:** revenue and transaction reports formatted for **URA tax** filing and **UCC** compliance records.

### 7.10 Minimum Phase-1 admin (build these first)
Config & thresholds (7.2) · creator approval/suspend (7.3) · content takedown + live kill-switch (7.4) · payout batch approval + float monitor (7.5) · basic revenue/sales dashboard (7.7) · role-based login with audit (7.1). Everything else in §7 is valuable but can follow once the platform is live and earning.

---

## Change Log (v7)

**v7 — Content management & free/paid model:**

1. **New §4.5 Creator Content Management, Pricing Status & Deletion Policy.** Establishes that every video is free or paid, creator-set at upload or **editable later**, with content protection (§4.4) auto-swapping to match the current status. **Paid content is uncapped** (each earns and self-limits); **free content is governed** via an admin-tunable allowance (measured in free-minutes), a free-upload rate limit, and per-account-standing multipliers (§4.5.3) — to stop free-hosting/spam abuse without choking the reach funnel. Adds creator **delete / archive-unpublish / bulk** tools, and a **deletion policy**: unpublish keeps existing buyers' access, hard-delete is a heavier warned action, and **financial records are always retained** even when media is deleted. Free-content settings wired into admin config (§7.2). *(Chosen over the originally-floated flat "video cap," which would have capped platform revenue and punished prolific creators.)*

**v6 — Backend & database locked in:**

1. **New §2.4 Backend & Database — Cloudflare D1 + Workers**, with Durable Objects for live-chat realtime. Chosen over managed alternatives (Supabase/Neon) because cost stays **flat and predictable as users grow** and it consolidates with the existing R2 zero-egress stack. To keep D1's SQLite size ceiling a non-issue, §2.4 adds **mandatory data-placement discipline** (D1 holds only core relational state + the ledger; video→R2, chat→Durable Objects, logs/analytics→Analytics Engine/R2; cold data archived) plus **early-warning size monitoring** in the admin console (§7.6). Includes a **mandatory portability spec** (Drizzle ORM, UUID keys, standard SQL in the ledger, isolated data-access layer, portable migrations) so a future move to self-hosted Postgres on a VPS is a config-level change — via **Cloudflare Hyperdrive** (keep Workers, swap only the DB) or a full Node/VPS self-host. Added to the Phase-1 build list. *(Note: the earlier one-off mention of "Supabase Studio" in §7 was only an optional admin-UI tool, now replaced to avoid confusion — it was never a database recommendation.)*

**v5 — Admin console:**

1. **New §7 Platform Administration Console** — a rich, role-based web admin covering configuration/thresholds, creator management & KYC, content moderation with a live kill-switch, finance/wallets/payouts (Payout Fridays, float monitor, reconciliation), live-event & streaming-cost control, analytics (incl. the self-funding tracker), support/communications, and compliance/audit. Marked a **Phase-1 deliverable**, with a low-code build option and a "minimum Phase-1 admin" shortlist (§7.10) to keep initial cost down. Wired into the build-phasing note and top revision note.

**v4 — Developer-ready pass:**

1. **New §3.3 Live Duration-Based Price Floor (loss-prevention guard) — hard requirement.** Minimum live ticket = 5,000 UGX per declared hour (`LIVE_MIN_PRICE_PER_HOUR × ceil(D/60)`), enforced server-side, with runtime auto-termination at the declared duration + grace. Guarantees `platform_share ≥ streaming_cost` on every stream so long lives cannot go negative, while creator and platform both keep earning. Config constants (`LIVE_MIN_PRICE_PER_HOUR`, `STREAMING_COST_PER_VIEWER_MINUTE`) exposed for the owner to tune.
2. **Live streaming re-scoped into Phase 1 / Phase 2 (§2.3).** Launch uses a standard provider (Agora/ZEGOCLOUD) on its free tier — profitable on its own thanks to §3.3. The zero-egress split-HLS design is demoted to an **optional Phase-2 cost optimization**, explicitly not a launch requirement, so developers don't over-build.
3. **Build-phasing note added up top** — what to build now (near-zero cost) vs. what to reinvest in later.
4. **§3.2 simulation and §6.2 rewritten** to show honest Phase-1 standard-streaming economics (~+279,000 UGX on the reference event) and to demonstrate the guard flipping the 3-hour stress case from a ~690,000 UGX loss to a ~999,000 UGX profit.

**v3 — Feasibility pass:**

1. **Live streaming re-architected (split host/audience).** §2.3 replaces the single-tier interactive design with an interactive host tier (metered, 1–5 people) plus a **zero-egress HLS audience tier** over R2/CDN and an out-of-band chat/tipping channel. This converts live cost from per-viewer-minute to a **fixed per-stream fee**, roughly doubling net on the reference event and turning the previously loss-making stress case profitable (§6.2). §3.2 simulation and §4.2 updated accordingly; §4.2 now has creators declare an expected duration.
2. **Face concealment via free on-device blur/pixelation.** §4.3 replaces the paid AR face-mask category with **free ML Kit/MediaPipe face blur & pixelation (3 filters)** as the default privacy tool, with tracking fail-safes; entertainment AR masks (DeepAR/Banuba) are **deferred as an optional on-demand module**. Studio set rebalanced to 5 aesthetic + 3 privacy + 12 cinematic LUTs.
3. **On-device encoding** added to §2.2 as the default transcode path (server fallback only) to cut compute cost.
4. **New §6 Financial Viability, Unit Economics & Risk Notes** documents the recorded-vs-live economics, the live-cost fix, a self-funding threshold, revenue levers, cost-cutting summary, and compliance/fraud gaps.

**v2 — Content corrections (retained):**

1. **5,000 UGX clarified as a minimum, not a cap.** §3.2 and §4.2: 5,000 UGX is a hard price *floor*; creators may charge any amount at or above it, and the split percentages apply to whatever price is set.
2. **Clip length no longer fixed at 15 seconds.** §2.2 and §4.3 set a recommended maximum of **5 minutes** with a length-aware bitrate ladder.
3. **Creator anonymity supported.** (Superseded by v3's free-blur approach.)

---

The app works basicaly like tiktok, the swipe up and down, follows, messages, inbox, freinds, profile, comments on a video, search, liking, tags,

*Confidential — For Internal Development Team Only*
