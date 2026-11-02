# Security remediation progress

## Batch 1 — content isolation and moderation (30 October 2026)

Implemented locally; not deployed. Existing unrelated working-tree changes were retained.

- Reject client-supplied media and thumbnail object keys during content creation.
- Validate post-specific object namespaces before reads and deletion, including existing records.
- Project discovery responses consistently across feed, cards, metadata, profiles and search. Paid text bodies, auto-generated text titles and overlays are withheld from non-buyers. Full media object keys are not returned in discovery responses.
- Exclude paid text from public text matching so search cannot probe private bodies.
- Preserve owner/buyer access flags and reload the authorized card after purchase in the mobile player.
- Block public paid-photo thumbnails, including previously uploaded full-size originals. New paid-photo posts no longer upload their original as a cover. Profile/search grids use their existing fallback for these posts until a safe preview pipeline is built.
- Prevent shared caching of personalized content responses and media. Previously cached public responses or already downloaded copies cannot be recalled by this patch.
- Reject unpublished public metadata/thumbnail access. Archived content remains accessible to its existing buyers; quarantined and deleted content is unavailable.
- Guard creator writes against quarantine and inactive creator/user status in the database statement, preventing a stale ownership check from overriding moderation.
- Require a post-owned media reference before publishing a video or photograph.
- Restrict the public creator response to public identity and verification fields.
- Prevent the player from selecting an old free-video cache for a now-paid post.

Validation: 28 existing security/money tests plus 10 new content/access tests; backend and mobile TypeScript checks. HTTP tests cover anonymous and entitled content across all main discovery endpoints. External services and physical devices have not been exercised.

## Remaining work from the review

- Provider attendance measurement (current viewer metric is unique ticketed chat participants, not measured video attendance).
- Pending-payment recovery, payout cancellation/reconciliation, execution-time eligibility, refunds and disputes.
- Server-side media inspection and quotas, upload limits, orphan cleanup and moderation removal of stored objects.
- Production SMS adapter, account recovery, mandatory admin MFA and session revocation.
- Purchased-content library, complete moderation/reporting UI, music composition, privacy concealment and replay recording.
- Durable background jobs, pagination, cost measurement, monitoring, backups and load/device testing.

Operational release notes: deploy the backend changes together with the mobile update. Older clients cannot supply their own object references; paid text must be refetched after settlement. Previously exposed text/photos remain disclosed to anyone who already downloaded them. Inspect existing cross-post object references without deleting financial records, and purge any separately configured caches of previously public paid-photo thumbnails before launch. No deployment or remote-data cleanup was performed in this batch.

## Batch 2 — live enforcement (30 October 2026)

- Creator end, moderator kill and the overrun cron now close chat and invoke LiveKit provider shutdown. The broadcaster's publishing token is revoked with RemoveParticipant (LiveKit Cloud), then DeleteRoom disconnects the room. A failure of either transport leaves a persistent D1 shutdown obligation for cron retry.
- Migration `0012_live_shutdown.sql` adds the shutdown flag and queues previously terminal events for cleanup. Apply it before deploying the new Worker; it has only been applied to isolated test databases here.
- Live starts use an atomic ownership/active-status/state guard, so concurrent termination cannot be overwritten by a stale start request.
- Video-token and chat admission now share active-account, ticket, live-state and duration checks. The Durable Object repeats admission checks; active chat senders are periodically revalidated.
- Admission tokens last 60 seconds, and token issuance rechecks eligibility after signing. Token expiry does not terminate existing video sessions; provider shutdown does.
- Chat replaces duplicate connections for one account and counts distinct ticket holders, excluding the broadcaster. Existing financial snapshots and historical peak figures are not rewritten.
- Chat caps incoming frame length and message bursts. Closed room state persists through hibernation.
- The mobile live stage unmounts video on terminal/replaced notifications, and avoids retrying terminal rooms after failed handshakes.

Validation: 49 automated tests, backend/mobile TypeScript checks, a Wrangler dry-run bundle, and an isolated Miniflare/workerd smoke test covering real WebSocket ticket gating, duplicate replacement, shutdown and rejection after end. Provider API calls are mocked in tests; no live account or real broadcast was modified.

Release limitations: the existing two-minute cron bounds routine overrun detection/retry timing; provider outages can delay video disconnection while new grants remain blocked. LiveKit Cloud provides token revocation; self-hosted LiveKit does not provide the same guarantee. Before rolling this change into an existing live deployment, drain existing broadcasts and allow legacy six-hour admission tokens to expire; short new tokens cannot retroactively shorten old ones. Viewer counts remain a chat-presence proxy, and a measured provider-attendance pipeline is still required for authoritative streaming economics. Test broadcasting on actual devices and against the configured provider before production rollout.

## Batch 3 — payout execution and recovery (1 November 2026)

- Transfer claims now atomically require an executing batch, active creator and user, a positive net amount, and a destination phone/provider matching the reserved snapshot. Production also requires a verified phone. Ineligible payouts remain pending and held for finance review.
- The scheduled Worker verifies at most 20 previously claimed transfers per run, ordered by least recently checked. It never submits transfers. Provider errors, missing records and uncertain outcomes retain the hold; confirmed outcomes use the existing atomic ledger finalization.
- Finance administrators can POST `/admin/payouts/batches/:id/cancel-unsubmitted` (under the existing admin route mount). This releases only pending reservations, atomically and idempotently. Held/submitted transfers cannot be cancelled this way. Cancellation uses status `failed` with reason `cancelled_before_submission`; the batch lifecycle is retained, and the response shows each payout's actual outcome. No console button has been added yet.
- Eligibility is checked at the database claim boundary; an external provider request cannot be made atomic with subsequent account changes. Already claimed transfers must still be reconciled even if the account later becomes inactive.

Validation: 52 automated tests and backend TypeScript check passed, including changed account/destination checks, cancellation rollback, duplicate cancellation and background reconciliation without transfer resubmission. No real payment, deployment or remote database change was made. This batch needs no new schema migration; previously documented migrations remain prerequisites.

Still pending: background purchase-payment recovery, refunds/disputes, finance UI for cancellation and recovery exceptions, alerting for long-held transfers, and real-provider operational validation. A crash after claiming but before submitting deliberately retains funds until provider/manual investigation; automatic resubmission would risk a duplicate payment. The bounded recovery scan uses the existing timestamp column; add suitable indexes and durable scheduling as volume grows.

## Batch 4 — pending purchase recovery (1 November 2026)

- The scheduled Worker now verifies pending purchase references even without a buyer status request or webhook. Each run selects at most 20, oldest checked first, excluding rows touched in the last two minutes. An atomic timestamp claim prevents overlapping recovery runs from checking the same row during that interval.
- Recovery never initiates a charge, deletes a ledger row, or expires a payment based on age. Missing provider records, unknown outcomes, mismatched verification details and transient failures leave the purchase pending and preserve checkout deduplication. Confirmed provider failures mark it failed; confirmed successful payments use the existing validated, atomic settlement path.
- Unconfigured development simulation is excluded from automatic settlement. Logs contain internal transaction IDs only, without provider payloads or destination data.

Validation: all 55 tests passed, backend TypeScript passed, and the Wrangler dry-run bundle succeeded. New tests cover missed webhooks, overlapping recovery runs, no duplicate charges, unknown/mismatched outcomes, rollback and retry, confirmed failure, and bounded queue rotation. Provider requests are mocked; nothing was deployed and no real payment was made. No new migration is required.

Operational limits: recovery reuses updated_at as the last-check timestamp, not a dedicated attempt history. Throughput is capped at 20 purchase checks per cron run; persistent backlogs need monitoring, indexing and a durable queue as volume grows. Permanently unresolved references still require investigation; they are deliberately not recharged automatically. Failed/refunded rows are not polled by this job. Refunds/disputes, finance exception UI, alerting and provider/device validation remain outstanding. This section supersedes the earlier pending-purchase-recovery backlog item.

## Batch 5 — finance recovery dashboard (1 November 2026)

- The Payouts console now lists the oldest 50 pending purchases, shows their creation times and amounts, and flags delays over one hour for investigation. Finance/Super Admin can verify an individual purchase without initiating a charge. Provider references and buyer identifiers are excluded from this list; responses are private/no-store.
- Added a separate, audited batch verification action that checks up to 20 held transfers without submitting pending payouts. The existing execution action remains explicitly separate and can send money.
- Added the existing cancel-unsubmitted operation to the console with confirmation explaining that held transfers remain reserved and the batch is not closed. Batch details explain statuses and show cancellation/failure reasons and uncertain transfer IDs.
- Payment verification buttons disable while a request is active, and batch actions refresh both the list and details. Dynamic text is HTML escaped.

Validation: all 56 automated tests passed, including HTTP authentication/finance-role checks and verification without submission. Backend TypeScript, console JavaScript syntax, and Worker dry-run build passed. No real provider calls or deployment. Browser visual/interaction validation remains outstanding; these checks do not constitute a browser usability test.

Remaining finance limitations: the purchase list is capped at the oldest 50 rather than fully paginated; unresolved exceptions have no assignment/case workflow. One-hour attention text is an operational heuristic, not a provider SLA. Manual payment verification currently has ledger provenance but no separate admin-action audit event. Notifications/alerting, refunds/disputes, provider validation and broader operational/security work remain outstanding.

## Batch 6 — finance audit completeness (1 November 2026)

- Manual payment verification now records an admin-attributed request before contacting the provider, followed by a completion or failure event linked by a unique attempt ID. An interrupted attempt remains visible even when no completion event is written.
- Audit details include only internal identifiers and a bounded status/reason; provider payloads and exception messages are excluded. A failure to write the initial audit event prevents provider verification. Settlement and audit writes are separate: an audit-write failure after settlement can return an error even though the payment settled; retries remain financially idempotent.
- The console suppresses overlapping batch actions for the same batch while a request is active, including conflicting execute/cancel clicks. Database guards remain authoritative across separate sessions.

Validation: all 57 tests passed, including successful/failed manual verification audit attribution, paired attempt IDs, payload redaction and single wallet credit. Backend TypeScript and console JavaScript syntax passed. Browser interaction testing, deployment, real-provider validation, refunds/disputes and the remaining security/operational work are still outstanding. This resolves the separate payment-verification audit gap documented in Batch 5.

## Batch 7 — checkout availability (1 November 2026)

- Content and live-ticket checkout now reject inactive/missing creator-owner accounts, even when the separate creator profile still says active.
- Broadcasting events must have a start time and remain within declared duration plus configured grace before checkout can proceed. Scheduled presales remain supported. This closes the stale-live-status window before cron termination.
- Rejected attempts create no transaction and send no charge request. Existing payment settlement remains unchanged so money already collected still has a ledger record.

Validation: 59 tests passed, backend TypeScript, dry-run Worker build and isolated Worker-runtime smoke passed. Tests cover disabled owners for both sale types, expired/malformed broadcasts and valid scheduled/current events. Corrected a pre-existing timing-sensitive LiveKit test to compare revocation time against invocation time rather than the later assertion time.

Limits: eligibility checks occur before charging; changes after those checks and provider completion after a broadcast ends still require the outstanding refund/dispute workflow. No deployment, real-provider payment or remote-data changes were performed.

## Batch 8 — basic content-upload validation (1 November 2026)

- Primary photo uploads are limited to 8 MiB and thumbnails to 2 MiB. A bounded reader counts actual streamed bytes, cancels oversized streams and rejects before writing to R2; it does not trust Content-Length or metadata size claims.
- Photos/thumbnails accept JPEG, PNG and WebP MIME types with matching basic signatures. SVG, HTML, missing/unsupported types, empty bodies and mismatched signatures are rejected. Stored MIME metadata is normalized.
- Primary media uploads are rejected for text posts. Video uploads accept MP4, QuickTime and WebM MIME types only; video bytes are not decoded or size-limited by this change.

Validation: the 62-test suite passed, followed by 14 focused content/image tests including an additional integration test (63 tests now in the suite). Backend TypeScript and dry-run Worker build passed. Tests verify size enforcement without relying on headers, stream cancellation, split signatures and rejection before storage writes. No deployment or real storage upload was performed.

Limitations: signatures are only preliminary screening, not full decoding, malware detection or proof of a valid playable file. Image buffering is bounded per request but concurrent uploads still consume memory. Full image decoding/dimension limits, streaming video byte limits, verified video durations, per-account quotas/rate limits and orphan cleanup remain outstanding. Avatar, music and background upload routes are outside this batch. Larger images and unsupported image formats now receive explicit errors; mobile/device validation remains necessary.

## Batch 9 — admin-approved cost-based live pricing (1 November 2026)

Added a Pricing calculator tab, finance preview endpoints, Super Admin approval with effective dates, atomic policy/audit persistence, and versioned cost assumptions. New events use cost-based 15/30/60-minute floors after activation, with protection for higher current fees, grace and creator overrides. Existing event prices, purchases and balances remain unchanged. No policy was activated or deployed.

See PRICING_POLICY.md for assumptions, calculation, operation and limits. All 66 tests passed, backend TypeScript, console syntax and dry-run build passed. Rates/FX are not automatically refreshed; bitrate is not enforced; recorded-content floors remain separate; legacy analytics are not actual provider-cost accounting. Browser/device testing remains outstanding.

## Batch 10 — automatic USD/UGX reference rates (1 November 2026)

Added a daily 03:17 UTC exchange-rate refresh, free no-key ExchangeRate-API integration with attribution, validated cached rates with provenance, stale-data warnings, automatic calculator prefilling/recalculation on opening, and explicit manual override. Super Admin approval still controls price changes. Approval validates freshness and reviewed rate, and snapshots FX provenance into policy/audit records. Outages preserve the last successful rate; no existing policy, event or balance is changed by fetching rates.

70 tests passed, backend TypeScript, console syntax and dry-run bundle passed. No migration, deployment or production policy activation. See PRICING_POLICY.md for cron timing, first-run behavior and operational limits. This supersedes the earlier manual-only exchange-rate limitation.
