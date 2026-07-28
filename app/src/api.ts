import Constants from "expo-constants";
import { File } from "expo-file-system";

/** Backend base URL: env override → app.json extra → deployed default. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://midpay-backend.midpay.workers.dev";

let token: string | null = null;
export function setAuthToken(t: string | null): void {
  token = t;
}
export function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...authHeaders(),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body.error as string) ?? "unknown",
      (body.message as string) ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}

// --- Types (mirror backend responses) ---
export interface User {
  id: string;
  phone: string;
  handle: string;
  displayName: string | null;
  isAdmin?: boolean;
}

/**
 * A creator text overlay drawn over the media in the player (composed at
 * playback, never baked in). Coords normalized to the media rect; (x,y) = the
 * overlay box's top-left. Mirrors the backend `TextOverlay`.
 */
export interface TextOverlay {
  text: string;
  x: number;
  y: number;
  size: number; // font size as a fraction of media width
  color: string;
  bg: string | null; // shape background colour, or null for none
}

/** Visual style for a text post (gradient/solid background + styled caption). */
export interface TextStyle {
  bg: string[];
  bgImage?: string | null;
  color: string;
  font: string | null;
  align: "left" | "center" | "right";
  bold?: boolean;
}

export interface FeedItem {
  id: string;
  kind: "video" | "photo" | "text";
  title: string | null;
  description: string | null;
  overlays?: TextOverlay[] | null;
  textStyle?: TextStyle | null;
  pricing: "free" | "paid";
  priceUgx: number | null;
  /** True when the signed-in viewer already bought this paid item. */
  owned: boolean;
  likeCount: number;
  commentCount: number;
  purchaseCount: number;
  publishedAt: string | null;
  creatorHandle: string;
  creatorDisplayName: string | null;
  creatorUserId: string;
  creatorAvatarR2Key?: string | null;
  thumbnailR2Key?: string | null;
}

export interface CommentItem {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  author: { id: string; handle: string; displayName: string | null; avatarR2Key?: string | null };
}

export interface ConversationSummary {
  id: string;
  otherUserId: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

// --- Auth (mobile + password) ---
export const signup = (phone: string, password: string) =>
  req<{ token: string; user: User; isNew: boolean }>("/auth/signup", {
    method: "POST",
    json: { phone, password },
  });

export const loginPassword = (phone: string, password: string) =>
  req<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    json: { phone, password },
  });

// --- Auth (legacy OTP — kept for transition) ---
export const requestOtp = (phone: string) =>
  req<{ challengeId: string; devCode?: string; bypass?: boolean }>("/auth/otp/request", {
    method: "POST",
    json: { phone },
  });

export const verifyOtp = (phone: string, code: string) =>
  req<{ token: string; user: User; isNew: boolean }>("/auth/otp/verify", {
    method: "POST",
    json: { phone, code },
  });

export const me = () => req<{ user: User }>("/auth/me");

// --- Feed / content ---
export const feed = (before?: number) =>
  req<{ feed: FeedItem[] }>(`/content/feed?limit=15${before ? `&before=${before}` : ""}`);

export const mediaUrl = (contentId: string) => `${API_URL}/content/${contentId}/media`;

/** Public cover image for a post (video first-frame / photo). `version` busts cache. */
export const thumbnailUrl = (contentId: string, version?: string | null) =>
  `${API_URL}/content/${contentId}/thumbnail${version ? `?v=${encodeURIComponent(version.slice(-12))}` : ""}`;

/**
 * Stream a local file to the backend with a binary PUT. Uses expo-file-system's
 * native streaming upload instead of `fetch(uri).blob()` — the blob path base64-
 * copies the whole file into the JS heap (OOM risk on large videos) and is more
 * prone to connection resets on flaky networks.
 */
async function putFile(url: string, fileUri: string, contentType: string) {
  return new File(fileUri).upload(url, {
    httpMethod: "PUT",
    headers: { "content-type": contentType, ...authHeaders() },
  });
}

export async function uploadThumbnail(contentId: string, fileUri: string) {
  // Best-effort; never block publishing.
  try {
    await putFile(`${API_URL}/content/${contentId}/thumbnail`, fileUri, "image/jpeg");
  } catch {
    // ignore
  }
}

export const like = (contentId: string) =>
  req(`/content/${contentId}/like`, { method: "POST" });
export const unlike = (contentId: string) =>
  req(`/content/${contentId}/like`, { method: "DELETE" });

export const listComments = (contentId: string) =>
  req<{ comments: CommentItem[] }>(`/content/${contentId}/comments`);
export const addComment = (contentId: string, body: string, parentId?: string) =>
  req<{ comment: CommentItem }>(`/content/${contentId}/comments`, {
    method: "POST",
    json: { body, ...(parentId ? { parentId } : {}) },
  });
export const likeComment = (contentId: string, commentId: string) =>
  req(`/content/${contentId}/comments/${commentId}/like`, { method: "POST" });
export const unlikeComment = (contentId: string, commentId: string) =>
  req(`/content/${contentId}/comments/${commentId}/like`, { method: "DELETE" });

// --- Creator / upload ---
export const applyCreator = () => req("/creators/apply", { method: "POST" });

export const createContent = (input: {
  kind: "video" | "photo" | "text";
  title: string;
  description?: string;
  pricing: "free" | "paid";
  priceUgx?: number;
  durationSeconds?: number;
  overlays?: TextOverlay[];
  textStyle?: TextStyle;
}) => req<{ content: { id: string } }>("/content", { method: "POST", json: input });

/** Paid-content price floors (photos have a lower floor than videos). */
export const getPricing = () =>
  req<{ recordedFloor: number; photoFloor: number }>("/content/pricing");

// --- Text backgrounds (admin-uploaded catalog) ---
export const backgroundImageUrl = (id: string) => `${API_URL}/backgrounds/${id}/image`;
export const listBackgrounds = () => req<{ backgrounds: { id: string }[] }>("/backgrounds");
export const createBackground = () => req<{ background: { id: string } }>("/backgrounds", { method: "POST" });
export const deleteBackground = (id: string) => req(`/backgrounds/${id}`, { method: "DELETE" });
export async function uploadBackgroundImage(id: string, fileUri: string, contentType = "image/jpeg") {
  const res = await putFile(`${API_URL}/backgrounds/${id}/image`, fileUri, contentType);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, "upload_failed", "Background upload failed");
  }
}

export async function uploadMedia(
  contentId: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const res = await putFile(mediaUrl(contentId), fileUri, contentType);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, "upload_failed", "Media upload failed");
  }
}

export const publishContent = (contentId: string) =>
  req(`/content/${contentId}/publish`, { method: "POST" });

/** A single post in full feed shape (to open from search / deep links). */
export const getCard = (contentId: string) =>
  req<{ item: FeedItem }>(`/content/${contentId}/card`);

// --- Search ---
export interface SearchResults {
  creators: { id: string; handle: string; displayName: string | null; avatarR2Key: string | null }[];
  posts: FeedItem[];
  sounds: { id: string; title: string; artist: string | null }[];
  comments: { id: string; body: string; contentId: string; authorHandle: string }[];
}
export const search = (q: string) => req<SearchResults>(`/search?q=${encodeURIComponent(q)}`);

// --- Payments ---
export const checkout = (type: "video_unlock" | "live_ticket", targetId: string) =>
  req<{ transactionId: string; txRef: string; simulated: boolean }>("/payments/checkout", {
    method: "POST",
    json: { type, targetId },
  });

/** DEV ONLY: settle a simulated charge by posting the webhook ourselves. With
 *  real Flutterwave keys the STK push + provider webhook replace this. */
export const devSettle = (txRef: string, amountUgx: number) =>
  req("/payments/webhook", {
    method: "POST",
    json: { event: "charge.completed", data: { tx_ref: txRef, status: "successful", amount: amountUgx, currency: "UGX" } },
  });

// --- Messaging ---
export const conversations = () =>
  req<{ conversations: ConversationSummary[] }>("/conversations");
export const messagesIn = (conversationId: string) =>
  req<{ messages: Message[] }>(`/conversations/${conversationId}/messages`);
export const sendMessage = (toUserId: string, body: string) =>
  req<{ message: Message }>("/messages", { method: "POST", json: { toUserId, body } });
export const markRead = (conversationId: string) =>
  req(`/conversations/${conversationId}/read`, { method: "POST" });

// --- Profiles ---
export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string | null;
  avatarR2Key?: string | null;
  bio?: string | null;
  followers: number;
  following: number;
  /** Older backends omit these — treat as 0/false. */
  likes?: number;
  posts?: number;
  isFollowing?: boolean;
  isSelf?: boolean;
}

/** A user's published posts, for the profile grid. */
export const userContent = (userId: string) =>
  req<{ content: FeedItem[] }>(`/users/${userId}/content`);

/**
 * Public avatar URL. `version` (the avatarR2Key) busts the cache the instant a
 * user uploads a new picture — the URL itself is stable.
 */
export const avatarUrl = (userId: string, version?: string | null) =>
  `${API_URL}/users/${userId}/avatar${version ? `?v=${encodeURIComponent(version.slice(-12))}` : ""}`;

/** Live "is this @username free?" check for the profile editor. */
export const checkHandle = (handle: string) =>
  req<{ handle: string; available: boolean; reason?: string }>(
    `/users/handle-available?handle=${encodeURIComponent(handle)}`,
  );

export const updateProfile = (input: {
  displayName?: string | null;
  bio?: string | null;
  handle?: string;
}) =>
  req<{ user: { id: string; displayName: string | null; bio: string | null; avatarR2Key: string | null } }>(
    "/users/me",
    { method: "PATCH", json: input },
  );

export async function uploadAvatar(fileUri: string, contentType = "image/jpeg") {
  const res = await putFile(`${API_URL}/users/me/avatar`, fileUri, contentType);
  const body = (() => {
    try {
      return JSON.parse(res.body) as { error?: string; message?: string; user?: { avatarR2Key: string | null } };
    } catch {
      return {} as { error?: string; message?: string; user?: { avatarR2Key: string | null } };
    }
  })();
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(res.status, body.error ?? "upload_failed", body.message ?? "Avatar upload failed");
  }
  return { user: body.user ?? { avatarR2Key: null } };
}

export const profile = (userId: string) =>
  req<{ profile: PublicProfile }>(
    `/users/${userId}`,
  );
export const follow = (userId: string) => req(`/users/${userId}/follow`, { method: "POST" });
export const unfollow = (userId: string) => req(`/users/${userId}/follow`, { method: "DELETE" });
