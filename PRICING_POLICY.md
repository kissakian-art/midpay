# Live cost-based pricing

Implemented locally; no provider account, live policy or production price was changed.

## Admin workflow

1. Open **Pricing calculator** in the admin console. Finance and Super Admin can view and calculate; only Super Admin can approve.
2. Enter the budget USD/UGX rate and conversion surcharge, LiveKit participant-minute and outgoing-GB rates, average total bitrate and network overhead, grace minutes, collection percentage/fixed fee, budgeted creator share, per-ticket overhead, reserve and desired profit.
3. Choose 15-, 30- or 60-minute blocks and a whole-UGX rounding increment. Choose the effective date/time (shown in your browser's local timezone), then calculate an example duration.
4. Review the projection and approve. The policy and audit record are committed atomically. Approved policy history includes future changes and the original assumptions.

The seed rates of USD 0.0005/participant-minute and USD 0.12/outgoing GB are LiveKit Ship overage rates checked on 1 November 2026: https://livekit.com/pricing . The FX rate of 3,800, percentage fees, bitrate and overhead are illustrative editable assumptions, not verified account tariffs or live exchange rates. No automatic FX feed or provider price scraping is installed.

## Calculation

Budgeted minutes = duration rounded upward to selected block + grace minutes.
Data GB = total bitrate Mbps × budgeted minutes × 60 / 8000 × network-overhead multiplier.
Transport USD = participant minutes × USD/minute + data GB × USD/GB.
Transport UGX = transport USD × budget USD/UGX × conversion surcharge multiplier.
Required platform budget = (transport UGX + overhead per ticket) × reserve multiplier + desired profit.
Gross ticket floor = (platform budget / platform fraction + fixed collection fee) / (1 − collection percentage), rounded upward.

The creator-share assumption must be at least 70%, covering the normal highest live tier. Scheduling uses a higher creator-specific override if applicable. Scheduling also uses the larger of the policy and current collection percentage/grace allowance. The calculator's preview uses entered assumptions; if current operational settings are higher, the actual scheduling quote is higher. Review both settings when approving.

Monthly plan allowances are deliberately not subtracted from marginal ticket costs. Allocate subscriptions (including included usage), broadcaster connections, Cloudflare, recording, taxes, other operating expenses and free-use subsidies into overhead per ticket using a realistic sales forecast. Avoid double-counting when reconciling forecasts with monthly invoices. Low sales can leave fixed costs unrecovered even with this floor.

## Application and preservation

Until a policy is effective, the existing LIVE_MIN_PRICE_PER_HOUR rule remains in force. Once effective, cost-based floors replace that legacy hourly rule for newly scheduled events. Existing events retain their ticket price and priceFloorAppliedUgx; no existing event, transaction, entitlement or creator balance is rewritten. The mobile schedule form continues using the existing server quote endpoint, now personalized for creator overrides.

Only the minimum is calculated; creators can price above it. Recorded-video/text/photo floors remain separately editable through Config. Cost-policy fee assumptions do not change actual transaction collection deductions or creator splits: those remain governed by their existing settings. This is a minimum-price model, not provider invoice accounting.

## Limits and validation

Bitrate is a budgeting input, not an enforced encoder cap. Actual attendee time, bandwidth, retries, provider rounding, taxes and account tariffs can differ. Policies do not guarantee profit. Later changes to grace, fees or creator overrides may change new-event quotes; existing events remain grandfathered. Avoid increasing promised creator shares on existing events without reviewing their economics. Existing analytics still use the legacy streaming-cost estimate; they have not been converted into actual provider-cost accounting.

No migration is needed: policies are versioned JSON records in platform_config with immutable audit entries. Effective dates are limited to one year ahead; policy durations to seven days. Browser visual/device testing and production rollout remain outstanding.

Validation: 66 automated tests passed, including policy math, block rounding, invalid inputs, rollback, scheduled activation, existing event preservation, below-floor rejection, higher fees/grace/creator overrides and role restrictions. Backend TypeScript, console JavaScript syntax and Wrangler dry-run build passed.

## Automatic exchange-rate update (supersedes manual-only FX notes above)

The Worker now has a separate daily cron at 03:17 UTC (06:17 Uganda time). It fetches https://open.er-api.com/v6/latest/USD using the free, no-key ExchangeRate-API endpoint and stores only the USD/UGX reference rate and provenance in platform_config. Provider documentation: https://www.exchangerate-api.com/docs/free . Attribution is displayed in the pricing calculator as required.

The calculator defaults to the latest cached rate and automatically calculates a suggestion when opened. Reload the calculator to obtain a newer cached rate. Conversion surcharge remains an independent editable buffer. Successful fetches are cached for at least 23 hours. Responses must contain a positive finite numeric UGX rate, USD base, successful status, and a provider timestamp no more than 72 hours old or five minutes in the future; older-than-cached responses are rejected. A ten-second timeout bounds the request. Failed fetches retain the last successful rate and retry on the next daily run. No success is fabricated on failure.

The UI shows provider update time and retrieval time. Automatic approval is blocked if no rate exists, the provider data is older than 72 hours, or the rate has changed since review. An explicit manual override remains available. Approval snapshots the reference source, rate and timestamps into both the policy and its audit record; manual approvals are marked manual. Daily refresh never changes approved policies, existing event prices or creator balances.

No provider API key or new migration is required. A new deployment's cache remains empty until its first daily trigger runs; the UI clearly flags this and permits manual override. Public reference rates are not guaranteed card settlement rates. The rate provider's availability and published daily update timing remain external dependencies. This update is local and not deployed.

Validation: all 70 tests passed, backend TypeScript, console JavaScript syntax and Worker dry-run bundle passed. Automated provider tests use mocked responses; the public endpoint and UGX support were separately verified read-only. Browser/device testing remains outstanding.
