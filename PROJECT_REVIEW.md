# MidPay application review

Reviewed the local source on 2 November 2026. “Implemented” means the checkout contains an executable path. Production deployment, merchant onboarding, mobile-network delivery times and provider balances cannot be established from the checkout.

## Purpose and target users

MidPay lets Ugandan creators sell individual posts and tickets to live broadcasts in UGX. A viewer uses a phone and mobile money for checkout. A creator can publish from the same account, earn a share of verified sales, and request a transfer to their registered number. The owner funds USD-denominated streaming and storage separately and manages pricing, payout liquidity and exceptions.

## People and features

| Role | Implemented capabilities |
|---|---|
| Visitor | Browse public posts, creator profiles, search results and live discovery. Paid bodies and original media require the appropriate access. |
| Registered viewer | Phone-based registration and login, profile and avatar editing, following, feed, likes, comments and replies, reporting, conversations and messages, paid unlocks, live tickets, live video, chat and reactions. |
| Creator | Instant creator application, studio capture and editing, text/photo/video posts, music and backgrounds, upload, price, publish, archive and delete. Schedule, start and end a ticketed broadcast. Review sales, engagement, live statements, wallet balances and withdrawal history. |
| Super admin | Admin authentication and optional second-factor setup, business configuration and pricing approval, finance and moderation controls. |
| Finance | Review purchases, verify pending payments, manage payout batches, check obligations, inspect reports and preview live pricing. |
| Moderator | Review reports, quarantine, restore or remove content, stop broadcasts, and suspend, ban, verify or reinstate creators. |
| Analyst and support | Analyst has read access to reporting and configuration routes. Support is a defined admin role. The role name alone does not grant finance or moderation permissions. |

Feature evidence includes the [mobile screens](app/src/screens), [HTTP routes](src/http/routes), and [admin role checks](src/http/routes/admin.routes.ts).

## Journey from registration to receipt

1. The user registers with a phone number. Production phone verification requires a working SMS integration. Development has explicitly gated simulation paths. Signed-in users can browse, interact and apply to become creators.
2. A creator publishes a free or paid post, or schedules a live event with a declared duration and a ticket price at or above the server-calculated minimum. For new events the creator sees the fixed share before starting.
3. A viewer chooses an unlock or ticket and authorizes a mobile-money charge. A pending request can survive an interrupted connection. MidPay verifies the collection and records the payment, entitlement, wallet credit and sales counters together. Repeated confirmation must not create another sale.
4. The buyer can retrieve the purchased media or enter the live event when admission checks pass. During a broadcast the host can see connected video viewers, chat presence and paid tickets as distinct measures. One paid ticket can remain valid when a viewer disconnects and rejoins.
5. The creator opens the session statement for gross receipts, recorded collection fees, net pool, creator share, MidPay share and pending payment count. Normally completed sessions release credited earnings into the eligible withdrawal balance. Moderated or interrupted sessions can require review.
6. Once self-service payouts are enabled, a creator selects an amount and network, reviews the deduction and net receipt, and confirms. The server reserves the amount and initiates a transfer to the registered phone. Processing continues until provider verification confirms success or failure. A confirmed failure releases reserved funds. Finance staff handle exceptions, while routine requests require no individual admin approval.

## Revenue, pricing and worked example

The ledger snapshots the amounts for each purchase in whole UGX. Recorded unlocks default to a 70% creator share of the pool after collection fees. Newly scheduled live events default to 60% unless the creator has an override. Older events retain per-purchase tiers or overrides. Statements sum recorded amounts so subsequent rate changes cannot rewrite past receipts. See [pricing](src/services/pricing.ts), [checkout](src/services/payments/payments.service.ts) and [session statements](src/services/creator-analytics.service.ts).

The automated finance test includes a **5,000 UGX live ticket** with a configured 3% collection fee and 60% creator share. The recorded fee is **150 UGX**, leaving **4,850 UGX**. The creator earns **2,910 UGX** and MidPay receives **1,940 UGX** before expenses. With ten identical paid tickets, the statement would show 50,000 UGX gross, 1,500 UGX in collection fees, 29,100 UGX for the creator and 19,400 UGX for MidPay. The number still watching when the host ends the session does not affect these receipts. [Worked test](tests/security-and-money.test.mjs)

LiveKit and Cloudflare are operating expenses. The ticket calculation does not send either vendor a percentage on each sale. MidPay must pay their invoices from its share and other working capital. The collection fee shown is a configured deduction, not a reconciliation against a provider invoice. Withdrawal fees apply separately. One tested withdrawal of 4,000 UGX with an illustrative 0.5% plus 100 UGX deduction delivers 3,880 UGX. Merchant contracts determine which fees to configure.

An admin can preview and approve a future live price floor using duration, costs, exchange rate and creator share. Daily USD/UGX reference-rate refresh supports that calculation. An approved policy snapshots its inputs. A rate refresh does not silently change the approved floor or an existing ticket. [Pricing policy](PRICING_POLICY.md)

## Architecture

The Expo/React Native app calls a Hono API running on Cloudflare Workers. Drizzle maps the Cloudflare D1 SQLite database. R2 stores uploaded media. LiveKit transports live video, while a Durable Object coordinates each room’s chat and reactions. Worker schedules reconcile pending money movements, refresh exchange rates and close overdue sessions. [Worker entry point](src/index.ts) · [Service wiring](src/http/container.ts)

The [schema](src/db/schema) separates users and authentication from creator profiles, content metadata, live events, social activity and conversations. Transactions identify the buyer, creator, purchase target, provider reference and split snapshot. Entitlements grant access. Wallets hold balances, and journal entries record credits, reservations, releases and payout debits. Payout rows reference their wallet, creator and batch. Admin accounts, moderation reports, configuration history and audit records support oversight. Migration 0013 adds a nullable event share to distinguish new fixed-share events from historical events. [Migrations](drizzle/migrations)

## Payment controls and operational limits

| Area | Implemented | Limit or outstanding work |
|---|---|---|
| Identity and access | Phone verification, login limits, authenticated account-status checks, separate admin roles, creator ownership checks and buyer entitlements. | Production SMS delivery, operator configuration and device flows require live acceptance testing. |
| Paid media | Paid-text redaction, owner-scoped media keys, private originals, quarantine checks and image signature/size validation. | Signature checks do not fully decode images or provide malware scanning. Video MIME checks alone do not verify file contents. |
| Purchases | Verified callbacks, amount/currency/reference checks, duplicate-purchase constraints, atomic settlement, bounded reconciliation and audited finance intervention. | Payment confirmation and provider settlement into spendable payout float can happen at different times. |
| Withdrawals | Positive minimum, quoted fee, registered destination, atomic reservations, provider balance check, transfer claim before submission and verification before marking paid. Unknown outcomes retain the hold. | The balance check observes provider funds at a point in time. Concurrent payouts and outside debits can still affect liquidity. Interrupted or ambiguous transfers need reconciliation. A second aggregator and two-minute delivery are unverified. |
| Live | Short-lived admission grants, server-side ticket and role checks, runtime cap, retryable shutdown, active video participant counting and owner-only statements. | Provider outages make the current video count unavailable. Historical chat peaks do not establish historical video attendance. A replay storage field alone does not implement automatic recording and delivery. |
| Reporting and recovery | Wallet and session analytics, financial audit journal, admin verification and payout exception handling. | A refunded ledger status does not establish end-to-end refund automation. The source does not demonstrate production monitoring, disaster recovery drills or a payout latency SLA. |

## Scalability and owner decisions

High-volume purchases create multiple D1 writes per sale. Statements group transaction history, and eligible-balance checks join paid live sales to event status. Measure query plans and latency under realistic concurrency before setting a capacity target. Recovery processes bounded batches, so a large outage can leave a backlog beyond a single schedule interval. Monitor the age of the oldest unconfirmed purchase, unsubmitted withdrawal and held transfer.

Broadcast cost depends on connected viewer-minutes, bitrate and provider terms. Chat peaks and tickets sold cannot determine the actual USD bill. Budget in UGX with a margin for exchange-rate changes, then reconcile invoice costs and receipts. Frequent creator dashboard polling also consumes API, D1 and LiveKit capacity. Production testing should include a busy room, delayed payments, network interruption, duplicate confirmations and a low provider balance.

Before activation, apply the migrations, verify both mobile networks, configure the minimum and actual withdrawal fees, fund the provider wallet and test transfers to registered phones. Keep self-service disabled until that exercise passes. Ask candidate aggregators for the percentage of recipients credited within 120 seconds on each network, their prefunding and settlement arrangements, and how to query unknown outcomes by reference.

Local validation covered 77 passing tests, backend and mobile TypeScript checks, Worker dry-run bundling, and an isolated Worker smoke test with migrations, payments and live access. Real merchant transfers and production mobile delivery remain unverified.
