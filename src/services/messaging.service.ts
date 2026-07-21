import type { Conversation, Message } from "../db/schema";
import { MessagingRepository, type ConversationSummary } from "../repositories/messaging.repository";
import { UserRepository } from "../repositories/user.repository";
import { badRequest, forbidden, notFound } from "./errors";

/**
 * MessagingService — 1:1 direct messages / inbox (TikTok-like DMs). A pair of
 * users maps to exactly one conversation; sending finds-or-creates it.
 */
export class MessagingService {
  constructor(
    private readonly messaging: MessagingRepository,
    private readonly users: UserRepository,
  ) {}

  async send(senderId: string, toUserId: string, body: string): Promise<Message> {
    if (senderId === toUserId) throw badRequest("self_message", "You cannot message yourself");
    if (body.trim() === "") throw badRequest("empty_message", "Message body is required");
    if (!(await this.users.findById(toUserId))) throw notFound("user");

    let conversation = await this.messaging.findConversation(senderId, toUserId);
    if (!conversation) conversation = await this.messaging.createConversation(senderId, toUserId);

    const now = new Date();
    const message = await this.messaging.createMessage(conversation.id, senderId, body);
    await this.messaging.touchConversation(conversation.id, now);
    return message;
  }

  listConversations(userId: string): Promise<ConversationSummary[]> {
    return this.messaging.listForUser(userId);
  }

  private async participantConversation(userId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.messaging.getConversation(conversationId);
    if (!conversation) throw notFound("conversation");
    if (conversation.userAId !== userId && conversation.userBId !== userId) {
      throw forbidden("not a participant");
    }
    return conversation;
  }

  async listMessages(userId: string, conversationId: string): Promise<Message[]> {
    await this.participantConversation(userId, conversationId);
    return this.messaging.listMessages(conversationId);
  }

  async markRead(userId: string, conversationId: string): Promise<{ read: true }> {
    await this.participantConversation(userId, conversationId);
    await this.messaging.markRead(conversationId, userId, new Date());
    return { read: true };
  }
}
