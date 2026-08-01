import { sign } from "hono/jwt";

/**
 * LiveKit access tokens (Phase B live video). A LiveKit token is a standard
 * HS256 JWT signed with the project's API secret, carrying a `video` grant that
 * scopes the bearer to one room with publish/subscribe permissions. We mint it
 * server-side so the client never sees the API secret and permissions are
 * enforced by us (broadcaster = publish; ticket-holder = subscribe-only).
 *
 * Docs: https://docs.livekit.io/home/get-started/authentication/
 */
export interface LiveKitGrant {
  /** Room name — we use the live event id. */
  room: string;
  canPublish: boolean;
  canSubscribe: boolean;
}

export async function mintLiveKitToken(opts: {
  apiKey: string;
  apiSecret: string;
  /** Stable per-user identity — we use the user id. */
  identity: string;
  /** Display name shown to other participants (the handle). */
  name?: string;
  grant: LiveKitGrant;
  /** Token lifetime; a live session is bounded, 6h is ample. */
  ttlSeconds?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: opts.apiKey, // LiveKit matches this to the signing key
    sub: opts.identity,
    nbf: now,
    exp: now + (opts.ttlSeconds ?? 6 * 60 * 60),
    ...(opts.name ? { name: opts.name } : {}),
    video: {
      room: opts.grant.room,
      roomJoin: true,
      canPublish: opts.grant.canPublish,
      canSubscribe: opts.grant.canSubscribe,
      canPublishData: true, // lets clients send data messages if needed
    },
  };
  return sign(payload, opts.apiSecret, "HS256");
}
