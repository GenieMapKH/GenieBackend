import { MessageProtection } from './message-protection';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { ChatAttachmentService } from './chat-attachment.service';

/** A sent message can be edited for this long. */
export const EDIT_WINDOW_MS = 60 * 60 * 1000;

/** The replacement transport envelope of an edited message. */
export interface MessageEdit {
  ciphertext: string;
  nonce: string;
}

/** Who sent a message to whom: enough to tell both people's devices about a change. */
export interface MessageParties {
  senderId: string;
  recipientId: string;
}

const EDITED_FIELDS = {
  id: true,
  senderId: true,
  recipientId: true,
  ciphertext: true,
  nonce: true,
  createdAt: true,
  editedAt: true,
} as const;

/**
 * Editing and deleting one message. Managed edits are encrypted before storage;
 * participant authorization and the edit window apply to all messages.
 */
@Injectable()
export class MessageActionsService {
  private readonly logger = new Logger(MessageActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: ChatAttachmentService,
    private readonly protection: MessageProtection,
  ) {}

  /** Replaces the text of the sender's own message, within an hour of sending it. */
  async edit(
    userId: string,
    messageId: string,
    edit: MessageEdit,
    now = new Date(),
  ) {
    const message = await this.findFor(userId, messageId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can edit a message');
    }

    // The window is checked in the update itself, so a late edit cannot slip in.
    const editableSince = new Date(now.getTime() - EDIT_WINDOW_MS);
    const { count } = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        senderId: userId,
        createdAt: { gt: editableSince },
      },
      data: {
        ...this.protection.seal(edit, { id: messageId, ...message }),
        editedAt: now,
      },
    });
    if (count === 0) {
      throw new ForbiddenException(
        'A message can only be edited within an hour of sending it',
      );
    }
    return this.protection.view(
      await this.prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        select: EDITED_FIELDS,
      }),
    );
  }

  /** Hides the message from [userId] only; the other person keeps it. */
  async deleteForMe(
    userId: string,
    messageId: string,
  ): Promise<MessageParties> {
    const message = await this.findFor(userId, messageId);
    await this.prisma.chatHiddenMessage.createMany({
      data: [{ userId, messageId }],
      skipDuplicates: true,
    });
    return message;
  }

  /**
   * Deletes the sender's own message for both people, with nothing left in
   * its place. Replies to it no longer quote it. [attachmentPath] is the
   * file it carried, named by the app: only the app can read which one.
   */
  async deleteForEveryone(
    userId: string,
    messageId: string,
    attachmentPath?: string,
  ): Promise<MessageParties> {
    const message = await this.findFor(userId, messageId);
    if (message.senderId !== userId) {
      throw new ForbiddenException(
        'Only the sender can delete a message for everyone',
      );
    }
    // Checked before anything is deleted, so a wrong path changes nothing.
    if (attachmentPath)
      this.attachments.requireSentFile(message, attachmentPath);

    await this.prisma.message.deleteMany({
      where: { id: messageId, senderId: userId },
    });

    if (attachmentPath) {
      // The message is gone, so the file can no longer be opened; one left
      // behind only wastes space and is logged rather than failing.
      try {
        await this.attachments.removeFile(attachmentPath);
      } catch (error) {
        this.logger.error(
          'Could not delete the file of a deleted message',
          error,
        );
      }
    }
    return message;
  }

  /** The message, if [userId] is one of its two people. Anyone else is told it does not exist. */
  private async findFor(
    userId: string,
    messageId: string,
  ): Promise<MessageParties> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, recipientId: true },
    });
    if (
      !message ||
      (message.senderId !== userId && message.recipientId !== userId)
    ) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }
}
