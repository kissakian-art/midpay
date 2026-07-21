import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { conversations, messages, type Conversation, type Message } from "../db/schema";

/** Canonical ordering so a user pair maps to exactly one conversation row. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface ConversationSummary {
  id: string;
  otherUserId: string;
  lastMessageAt: Date;
  unreadCount: number;
}

/**
 * MessagingRepository — 1:1 DMs / inbox (§ TikTok-like messages). Durable social
 * state in D1.
 */
export class MessagingRepository {
  constructor(private readonly db: Database) {}

  findConversation(userA: string, userB: string): Promise<Conversation | undefined> {
    const [a, b] = orderedPair(userA, userB);
    return this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userAId, a), eq(conversations.userBId, b)))
      .get();
  }

  createConversation(userA: string, userB: string): Promise<Conversation> {
    const [a, b] = orderedPair(userA, userB);
    return this.db.insert(conversations).values({ userAId: a, userBId: b }).returning().get();
  }

  touchConversation(id: string, now: Date): Promise<unknown> {
    return this.db
      .update(conversations)
      .set({ lastMessageAt: now })
      .where(eq(conversations.id, id))
      .run();
  }

  getConversation(id: string): Promise<Conversation | undefined> {
    return this.db.select().from(conversations).where(eq(conversations.id, id)).get();
  }

  /** Inbox for a user: conversations they're in, newest first, with unread count. */
  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const convs = await this.db
      .select({
        id: conversations.id,
        userAId: conversations.userAId,
        userBId: conversations.userBId,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(or(eq(conversations.userAId, userId), eq(conversations.userBId, userId)))
      .orderBy(desc(conversations.lastMessageAt))
      .all();
    if (convs.length === 0) return [];

    // Unread = inbound messages (from the other user) not yet read, grouped.
    const unreadRows = await this.db
      .select({ conversationId: messages.conversationId, n: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          inArray(
            messages.conversationId,
            convs.map((c) => c.id),
          ),
          ne(messages.senderId, userId),
          isNull(messages.readAt),
        ),
      )
      .groupBy(messages.conversationId)
      .all();
    const unread = new Map(unreadRows.map((r) => [r.conversationId, r.n]));

    return convs.map((c) => ({
      id: c.id,
      otherUserId: c.userAId === userId ? c.userBId : c.userAId,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unread.get(c.id) ?? 0,
    }));
  }

  createMessage(conversationId: string, senderId: string, body: string): Promise<Message> {
    return this.db
      .insert(messages)
      .values({ conversationId, senderId, body })
      .returning()
      .get();
  }

  listMessages(conversationId: string): Promise<Message[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .all();
  }

  /** Mark all inbound (from the other user) messages in a conversation as read. */
  markRead(conversationId: string, readerId: string, now: Date): Promise<unknown> {
    return this.db
      .update(messages)
      .set({ readAt: now })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.senderId, readerId),
          isNull(messages.readAt),
        ),
      )
      .run();
  }
}
