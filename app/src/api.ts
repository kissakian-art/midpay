import Constants from "expo-constants";

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
}

export interface FeedItem {
  id: string;
  kind: "video" | "photo";
  title: string | null;
  description: string | null;
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
}

export interface CommentItem {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  author: { id: string; handle: string; displayName: string | null };
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

// --- Auth ---
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

// --- Creator / upload ---
export const applyCreator = () => req("/creators/apply", { method: "POST" });

export const createContent = (input: {
  kind: "video" | "photo";
  title: string;
  pricing: "free" | "paid";
  priceUgx?: number;
  durationSeconds?: number;
}) => req<{ content: { id: string } }>("/content", { method: "POST", json: input });

export async function uploadMedia(
  contentId: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const blob = await (await fetch(fileUri)).blob();
  const res = await fetch(mediaUrl(contentId), {
    method: "PUT",
    headers: { "content-type": contentType, ...authHeaders() },
    body: blob,
  });
  if (!res.ok) throw new ApiError(res.status, "upload_failed", "Media upload failed");
}

export const publishContent = (contentId: string) =>
  req(`/content/${contentId}/publish`, { method: "POST" });

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
export const profile = (userId: string) =>
  req<{ profile: { id: string; handle: string; displayName: string | null; followers: number; following: number } }>(
    `/users/${userId}`,
  );
export const follow = (userId: string) => req(`/users/${userId}/follow`, { method: "POST" });
export const unfollow = (userId: string) => req(`/users/${userId}/follow`, { method: "DELETE" });
