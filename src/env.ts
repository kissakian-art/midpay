/**
 * Env — the Worker's runtime bindings and vars (mirrors wrangler.toml).
 * Keep in sync with wrangler.toml bindings.
 */
export interface Env {
  // D1 primary datastore (§2.4).
  DB: D1Database;

  // Durable Objects: one LiveRoom per live event — chat/reactions/presence (§2.4).
  LIVE_ROOM: DurableObjectNamespace;

  // R2 media bucket (§2.2) — video, images, live replays. Never the DB.
  MEDIA: R2Bucket;

  // 'development' | 'production' — gates dev-only conveniences (e.g. returning
  // the OTP code in the response so you can test without a live SMS provider).
  ENVIRONMENT: string;

  // --- Secrets (set via `wrangler secret put`, NOT committed) ---
  // Signing key for session JWTs.
  JWT_SECRET: string;
  // Flutterwave (§3.1). Optional in dev — payments run in a simulated mode
  // until these are set. Real STK Push + payouts need them.
  FLW_SECRET_KEY?: string;
  // The secret hash you configure in the Flutterwave dashboard webhook; every
  // incoming webhook must present it in the `verif-hash` header (§3.1).
  FLW_WEBHOOK_HASH?: string;

  // Business-rule config DEFAULTS (§7.2). Live values come from platform_config.
  LIVE_MIN_PRICE_PER_HOUR: string;
  STREAMING_COST_PER_VIEWER_MINUTE: string;
  RECORDED_PRICE_FLOOR: string;
  LIVE_AUTO_TERMINATE_GRACE_MINUTES: string;
  CLIP_MAX_LENGTH_SECONDS: string;
  FLUTTERWAVE_FEE_PERCENT: string;
  MOBILE_MONEY_WITHDRAWAL_DUTY_PERCENT: string;
  MIN_PAYOUT_THRESHOLD_UGX: string;
  // Fixed monthly operating cost target for the self-funding tracker (§6.3/§7.7).
  MONTHLY_OPEX_TARGET_UGX: string;
  // "1" = OTP required at login; "0" = bypass (dev only). Admin-tunable.
  PHONE_VERIFICATION_ENABLED: string;
}
