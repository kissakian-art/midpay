import { sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { liveEvents } from "../db/schema";
import type { Env } from "../env";

/**
 * LiveRoom — one Durable Object per live event (§2.4): WebSocket chat,
 * reactions, and presence. High-frequency signals live HERE, never in D1;
 * the only D1 write is a throttled bump of the event's peak-concurrent-viewers
 * (which drives the §3.2 revenue-split tier).
 *
 * Uses the WebSocket Hibernation API so an idle room costs nothing: the DO is
 * evicted between messages and rehydrated on demand; per-socket identity rides
 * in the serialized attachment.
 *
 * Wire protocol (JSON):
 *   client → server: {type:"chat", body} | {type:"reaction", emoji}
 *   server → client: {type:"welcome", history, viewers}
 *                    {type:"chat", userId, handle, body, at}
 *                    {type:"reaction", handle, emoji}
 *                    {type:"presence", viewers}
 */

interface Attachment {
  userId: string;
  handle: string;
}

interface ChatMessage {
  type: "chat";
  userId: string;
  handle: string;
  body: string;
  at: number;
}

const HISTORY_KEY = "history";
const HISTORY_MAX = 50;
const CHAT_MAX_LEN = 500;

export class LiveRoom {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const userId = request.headers.get("x-user-id");
      const handle = request.headers.get("x-user-handle") ?? "user";
      const liveEventId = request.headers.get("x-live-event-id");
      if (!userId || !liveEventId) return new Response("missing identity", { status: 400 });

      await this.ctx.storage.put("liveEventId", liveEventId);

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ userId, handle } satisfies Attachment);

      const history = (await this.ctx.storage.get<ChatMessage[]>(HISTORY_KEY)) ?? [];
      const viewers = this.ctx.getWebSockets().length;
      server.send(JSON.stringify({ type: "welcome", history, viewers }));
      this.broadcast({ type: "presence", viewers }, server);
      await this.bumpPeak(viewers);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/stats") {
      return Response.json({ viewers: this.ctx.getWebSockets().length });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: { type?: string; body?: string; emoji?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const who = ws.deserializeAttachment() as Attachment;

    if (msg.type === "chat" && typeof msg.body === "string" && msg.body.trim()) {
      const chat: ChatMessage = {
        type: "chat",
        userId: who.userId,
        handle: who.handle,
        body: msg.body.trim().slice(0, CHAT_MAX_LEN),
        at: Date.now(),
      };
      // Ring buffer of recent messages for late joiners — DO storage, not D1.
      const history = (await this.ctx.storage.get<ChatMessage[]>(HISTORY_KEY)) ?? [];
      history.push(chat);
      if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
      await this.ctx.storage.put(HISTORY_KEY, history);

      this.broadcast(chat);
    } else if (msg.type === "reaction" && typeof msg.emoji === "string") {
      // Ephemeral: broadcast only, never stored.
      this.broadcast({ type: "reaction", handle: who.handle, emoji: msg.emoji.slice(0, 8) });
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcast({ type: "presence", viewers: this.ctx.getWebSockets().length });
  }

  private broadcast(payload: unknown, except?: WebSocket): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // socket already gone; hibernation API will reap it
      }
    }
  }

  /** Throttled D1 write: only when the current count exceeds the stored peak. */
  private async bumpPeak(viewers: number): Promise<void> {
    const knownPeak = (await this.ctx.storage.get<number>("peak")) ?? 0;
    if (viewers <= knownPeak) return;
    await this.ctx.storage.put("peak", viewers);

    const liveEventId = await this.ctx.storage.get<string>("liveEventId");
    if (!liveEventId) return;
    const db = createDb(this.env.DB);
    await db
      .update(liveEvents)
      .set({
        peakConcurrentViewers: sql`max(${liveEvents.peakConcurrentViewers}, ${viewers})`,
      })
      .where(sql`${liveEvents.id} = ${liveEventId}`)
      .run();
  }
}
