import { useCallback, useEffect, useRef, useState } from "react";
import { liveChatWsUrl } from "../api";

/**
 * useLiveRoom — a thin React wrapper over the LiveRoom Durable Object socket
 * (`GET /live/:id/chat`). It owns the WebSocket lifecycle (connect, reconnect
 * with backoff, teardown) and surfaces the room's three signals: chat history,
 * live viewer count, and ephemeral reactions.
 *
 * Wire protocol (server → client):
 *   {type:"welcome", history, viewers} | {type:"chat", userId, handle, body, at}
 *   {type:"reaction", handle, emoji}   | {type:"presence", viewers}
 * client → server: {type:"chat", body} | {type:"reaction", emoji}
 *
 * This is the whole live experience minus the video pixels — it needs no native
 * module and ships in the JS bundle.
 */

export interface LiveChatMessage {
  /** Synthesized locally (the wire messages carry no id). */
  id: string;
  userId: string;
  handle: string;
  body: string;
  at: number;
}

export interface LiveReaction {
  id: string;
  handle: string;
  emoji: string;
}

export type LiveConnState = "connecting" | "open" | "closed";

interface WireChat {
  type: "chat";
  userId: string;
  handle: string;
  body: string;
  at: number;
}

const CHAT_CAP = 200; // keep memory bounded on a long stream
const RECONNECT_MS = 2000;

let seq = 0;
const nextId = () => `lr_${Date.now()}_${seq++}`;

export function useLiveRoom(liveId: string | null, enabled: boolean) {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [viewers, setViewers] = useState(0);
  const [state, setState] = useState<LiveConnState>("connecting");
  const [reactions, setReactions] = useState<LiveReaction[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  // Latest-value refs so the reconnect closure never captures stale props.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const liveIdRef = useRef(liveId);
  liveIdRef.current = liveId;

  useEffect(() => {
    if (!liveId || !enabled) return;

    let closedByUs = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closedByUs || !enabledRef.current || !liveIdRef.current) return;
      setState("connecting");
      let ws: WebSocket;
      try {
        ws = new WebSocket(liveChatWsUrl(liveIdRef.current));
      } catch {
        retry = setTimeout(connect, RECONNECT_MS);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => setState("open");

      ws.onmessage = (e) => {
        let msg: {
          type?: string;
          history?: WireChat[];
          viewers?: number;
          userId?: string;
          handle?: string;
          body?: string;
          at?: number;
          emoji?: string;
        };
        try {
          msg = JSON.parse(typeof e.data === "string" ? e.data : "");
        } catch {
          return;
        }
        switch (msg.type) {
          case "welcome": {
            const history = (msg.history ?? []).map<LiveChatMessage>((h) => ({
              id: nextId(),
              userId: h.userId,
              handle: h.handle,
              body: h.body,
              at: h.at,
            }));
            setMessages(history);
            if (typeof msg.viewers === "number") setViewers(msg.viewers);
            break;
          }
          case "chat":
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                  id: nextId(),
                  userId: msg.userId ?? "",
                  handle: msg.handle ?? "user",
                  body: msg.body ?? "",
                  at: msg.at ?? Date.now(),
                },
              ];
              return next.length > CHAT_CAP ? next.slice(next.length - CHAT_CAP) : next;
            });
            break;
          case "presence":
            if (typeof msg.viewers === "number") setViewers(msg.viewers);
            break;
          case "reaction":
            setReactions((prev) => [
              ...prev.slice(-24),
              { id: nextId(), handle: msg.handle ?? "", emoji: msg.emoji ?? "❤️" },
            ]);
            break;
        }
      };

      const onDown = () => {
        setState("closed");
        if (closedByUs) return;
        if (retry) clearTimeout(retry);
        retry = setTimeout(connect, RECONNECT_MS);
      };
      ws.onclose = onDown;
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // already closing; onclose will schedule the retry
        }
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [liveId, enabled]);

  const sendChat = useCallback((body: string) => {
    const text = body.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", body: text }));
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "reaction", emoji }));
  }, []);

  /** Drop a reaction once its float animation is done (called by the screen). */
  const clearReaction = useCallback((id: string) => {
    setReactions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { messages, viewers, state, reactions, sendChat, sendReaction, clearReaction };
}
