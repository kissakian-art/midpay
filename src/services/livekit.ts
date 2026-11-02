import { sign } from "hono/jwt";
import type { Env } from "../env";
import { ApiError } from "./errors";

/** Unique active video-room identities, excluding the broadcaster. Not ticket sales or chat connections. */
export async function liveViewerCount(env: Env, room: string, ownerId: string): Promise<number> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) throw new Error('Video not configured');
  const url = new URL(env.LIVEKIT_URL);
  url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  if (url.protocol !== 'https:' && !(env.ENVIRONMENT === 'development' && url.protocol === 'http:')) throw new Error('Invalid video URL');
  const now = Math.floor(Date.now()/1000);
  const token = await sign({ iss: env.LIVEKIT_API_KEY, nbf: now, exp: now+60, video: { roomAdmin: true, room } }, env.LIVEKIT_API_SECRET, 'HS256');
  const response = await fetch(new URL('/twirp/livekit.RoomService/ListParticipants', url), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ room }), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json() as { participants?: { identity?: string; state?: string | number; kind?: string | number }[] };
  if (!response.ok || !Array.isArray(body.participants)) throw new Error('Viewer count unavailable');
  return new Set(body.participants.filter(p => typeof p.identity === 'string' && p.identity !== ownerId &&
    (p.state === 'ACTIVE' || p.state === 2) && (p.kind === undefined || p.kind === 'STANDARD' || p.kind === 0)).map(p => p.identity)).size;
}

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
  /** Short admission lifetime; provider control terminates active sessions. */
  ttlSeconds?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: opts.apiKey, // LiveKit matches this to the signing key
    sub: opts.identity,
    nbf: now,
    exp: now + (opts.ttlSeconds ?? 60),
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

/** Provider control calls are separate from client grants. Never return these
 * credentials or provider response bodies to a client or log. */
export async function closeLiveKitRoom(env: Env, room: string, ownerId: string): Promise<void> {
  const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, LIVEKIT_URL: address } = env;
  if (!key && !secret && !address) return; // no video could have been issued
  if (!key || !secret || !address) throw new ApiError(503, "live_video_unconfigured", "Live shutdown needs complete video configuration");
  const url = new URL(address);
  url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  if (url.protocol !== "https:" && !(env.ENVIRONMENT === "development" && url.protocol === "http:")) {
    throw new ApiError(503, "invalid_live_url", "Live video requires HTTPS");
  }
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ iss: key, nbf: now, exp: now + 60, video: { roomCreate: true, roomAdmin: true, room } }, secret, "HS256");
  async function call(method: string, body: object) {
    const response = await fetch(new URL(`/twirp/livekit.RoomService/${method}`, url), {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null) as { code?: string } | null;
    if (!result || typeof result !== "object") throw new ApiError(502, "live_shutdown_pending", "Live shutdown is awaiting provider confirmation");
    if (!response.ok && result.code !== "not_found") throw new ApiError(502, "live_shutdown_pending", "Live shutdown is awaiting provider confirmation");
    return result;
  }
  // Cloud revocation includes the broadcaster even when temporarily offline.
  // A cutoff just ahead of now also invalidates tokens issued in this second.
  // Only the owner can publish. Revoke that grant even when offline, then
  // disconnect all viewers with one room deletion (bounded provider calls).
  const removals = await Promise.allSettled([call("RemoveParticipant", {
    room, identity: ownerId, revoke_token_ts: Math.floor(Date.now() / 1000) + 1,
  })]);
  // Attempt deletion even if one removal failed; retain the outbox for retry.
  await call("DeleteRoom", { room });
  if (removals.some(result => result.status === "rejected")) throw new ApiError(502, "live_shutdown_pending", "Live shutdown is awaiting provider confirmation");
}
