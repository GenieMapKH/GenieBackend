import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService, SupabaseService } from '@tilomnov/shared';

/** Private bucket: nothing in it is readable without a signed URL from this service. */
const BUCKET = 'chat-attachments';
/**
 * Pictures are compressed to under 3 MB before they are encrypted, and the
 * app refuses files above 10 MB. Storage refuses more than this, which also
 * covers the few bytes encryption adds.
 */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_URL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an attachment lives. Both people are in the path, so access needs no lookup. */
export interface AttachmentLocation {
  senderId: string;
  recipientId: string;
  fileId: string;
}

/**
 * Files sent in a chat. They are encrypted on the sender's device; the key
 * travels inside the encrypted message, so the server only ever stores
 * unreadable bytes and decides who may fetch them.
 */
@Injectable()
export class ChatAttachmentService implements OnModuleInit {
  private readonly logger = new Logger(ChatAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseService,
  ) {}

  async onModuleInit() {
    try {
      await this.storage.ensureBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_ATTACHMENT_BYTES,
      });
    } catch (error) {
      this.logger.error(
        `Could not prepare the ${BUCKET} bucket: ${(error as Error).message}`,
      );
    }
  }

  /** Gives the sender one place to upload one encrypted file for the recipient. */
  async createUpload(senderId: string, recipientId: string) {
    if (recipientId === senderId) {
      throw new BadRequestException('You cannot message yourself');
    }
    const recipient = await this.prisma.user.findFirst({
      where: { id: recipientId, deactivatedAt: null },
      select: { id: true },
    });
    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    const location = { senderId, recipientId, fileId: randomUUID() };
    return {
      path: this.pathOf(location),
      uploadUrl: await this.storage.createSignedUploadUrl(
        BUCKET,
        this.pathOf(location),
      ),
    };
  }

  /** Only the two people in the conversation get a (short-lived) download link. */
  async createDownloadUrl(userId: string, location: AttachmentLocation) {
    if (userId !== location.senderId && userId !== location.recipientId) {
      throw new ForbiddenException('This file belongs to another conversation');
    }

    const url = await this.storage.createSignedDownloadUrl(
      BUCKET,
      this.pathOf(location),
      DOWNLOAD_URL_SECONDS,
    );
    if (!url) {
      throw new NotFoundException('File not found');
    }
    return { url };
  }

  /**
   * Deletes every file of the user's conversations: what they sent, and what
   * others sent to them. Called before the account itself is deleted, while
   * its messages still say who those others are.
   */
  async removeAllOf(userId: string): Promise<void> {
    const senders = await this.prisma.message.findMany({
      where: { recipientId: userId },
      select: { senderId: true },
      distinct: ['senderId'],
    });

    await this.storage.removeFolder(BUCKET, userId);
    for (const { senderId } of senders) {
      await this.storage.removeFolder(BUCKET, `${senderId}/${userId}`);
    }
  }

  /** Deletes every file the two people sent each other, both ways. */
  async removeConversation(userId: string, partnerId: string): Promise<void> {
    await this.storage.removeFolder(BUCKET, `${userId}/${partnerId}`);
    await this.storage.removeFolder(BUCKET, `${partnerId}/${userId}`);
  }

  /**
   * Refuses [path] unless it is a file [parties.senderId] sent to
   * [parties.recipientId]: a deleted message only takes its own file along.
   */
  requireSentFile(
    parties: { senderId: string; recipientId: string },
    path: string,
  ): void {
    const [senderId, recipientId, fileId, ...rest] = path.split('/');
    const isTheirs =
      senderId === parties.senderId && recipientId === parties.recipientId;
    if (!isTheirs || !fileId || !UUID.test(fileId) || rest.length > 0) {
      throw new BadRequestException('This file does not belong to the message');
    }
  }

  async removeFile(path: string): Promise<void> {
    await this.storage.removeFiles(BUCKET, [path]);
  }

  private pathOf(location: AttachmentLocation): string {
    return `${location.senderId}/${location.recipientId}/${location.fileId}`;
  }
}
