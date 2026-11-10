import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { ChatAttachmentService } from './chat-attachment.service';

/**
 * Archiving and deleting conversations. Each person has their own view of a
 * conversation (`chat_conversation_states`); only "delete for everyone"
 * touches the messages themselves.
 */
@Injectable()
export class ConversationStateService {
  private readonly logger = new Logger(ConversationStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: ChatAttachmentService,
  ) {}

  /**
   * Moves the conversation to the archive. It comes back to the main list by
   * itself when a newer message arrives, so nothing is missed.
   */
  async archive(userId: string, partnerId: string): Promise<void> {
    await this.ensureUser(partnerId);
    const now = new Date();
    await this.prisma.chatConversationState.upsert({
      where: { userId_partnerId: { userId, partnerId } },
      create: { userId, partnerId, archivedAt: now },
      update: { archivedAt: now },
    });
  }

  async unarchive(userId: string, partnerId: string): Promise<void> {
    await this.prisma.chatConversationState.updateMany({
      where: { userId, partnerId },
      data: { archivedAt: null },
    });
  }

  /**
   * Hides the conversation and its history from [userId] only. The other
   * person keeps theirs; a newer message brings the conversation back,
   * starting from that message.
   */
  async deleteForMe(userId: string, partnerId: string): Promise<void> {
    await this.ensureUser(partnerId);
    const now = new Date();
    await this.prisma.chatConversationState.upsert({
      where: { userId_partnerId: { userId, partnerId } },
      create: { userId, partnerId, clearedAt: now },
      update: { clearedAt: now, archivedAt: null },
    });
  }

  /**
   * Deletes every message between the two people, the files they sent and
   * the record of their calls, for both of them. It cannot be undone.
   */
  async deleteForEveryone(userId: string, partnerId: string): Promise<void> {
    await this.ensureUser(partnerId);
    await this.prisma.$transaction([
      this.prisma.message.deleteMany({
        where: {
          OR: [
            { senderId: userId, recipientId: partnerId },
            { senderId: partnerId, recipientId: userId },
          ],
        },
      }),
      this.prisma.callLog.deleteMany({
        where: {
          OR: [
            { callerId: userId, calleeId: partnerId },
            { callerId: partnerId, calleeId: userId },
          ],
        },
      }),
      this.prisma.chatConversationState.deleteMany({
        where: {
          OR: [
            { userId, partnerId },
            { userId: partnerId, partnerId: userId },
          ],
        },
      }),
    ]);

    // The messages are gone, so their files can no longer be opened; one
    // left behind only wastes space and is logged rather than failing.
    try {
      await this.attachments.removeConversation(userId, partnerId);
    } catch (error) {
      this.logger.error(
        'Could not delete the files of a deleted conversation',
        error,
      );
    }
  }

  /** Messages up to this moment are hidden from [userId], or null. */
  async clearedAt(userId: string, partnerId: string): Promise<Date | null> {
    const state = await this.prisma.chatConversationState.findUnique({
      where: { userId_partnerId: { userId, partnerId } },
      select: { clearedAt: true },
    });
    return state?.clearedAt ?? null;
  }

  private async ensureUser(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Conversation not found');
  }
}
