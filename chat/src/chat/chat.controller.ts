import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUserId, RateLimit, RateLimits } from '@tilomnov/shared';
import { requirePasswordProof } from './password-proof';
import { ChatAttachmentService } from './chat-attachment.service';
import {
  BackupOwnerProof,
  ChatBackupService,
  NewKeyBackup,
} from './chat-backup.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { pageOfConversations } from './conversation-pages';
import { ConversationStateService } from './conversation-state.service';
import {
  BackupOwnerProofDto,
  ConversationListQuery,
  CreateAttachmentDto,
  DeleteConversationDto,
  MessagePageQuery,
  ResetKeysDto,
  SetBackupDto,
  SetPublicKeyDto,
  UnlockBackupDto,
} from './dto/chat.dto';

const DEFAULT_PAGE_SIZE = 50;

@Controller('chat')
export class ChatController {
  /** At most 5 backup lookups per user every 15 minutes. PIN tries are counted by ChatBackupService. */
  private readonly backupRateLimiter: RateLimit;

  /** Uploads are cheap to request but cost storage: 20 per user every minute. */
  private readonly uploadRateLimiter: RateLimit;

  constructor(
    private readonly chatService: ChatService,
    private readonly backupService: ChatBackupService,
    private readonly attachmentService: ChatAttachmentService,
    private readonly conversationStates: ConversationStateService,
    private readonly gateway: ChatGateway,
    rateLimits: RateLimits,
  ) {
    this.backupRateLimiter = rateLimits.create(
      'chat-backup-lookup',
      5,
      15 * 60,
    );
    this.uploadRateLimiter = rateLimits.create('chat-upload', 20, 60);
  }

  @Post('keys')
  setPublicKey(@CurrentUserId() userId: string, @Body() dto: SetPublicKeyDto) {
    return this.chatService.setPublicKey(userId, dto.identityPublicKey);
  }

  /**
   * Replaces the caller's key pair and its backup in one step. With an existing
   * backup, `currentBackupVerifier` must prove its PIN (`403` wrong PIN, `429`
   * locked), or `passwordProofToken` the account password (`403` if not valid).
   */
  @Post('keys/reset')
  @HttpCode(HttpStatus.OK)
  async resetKeys(@CurrentUserId() userId: string, @Body() dto: ResetKeysDto) {
    return this.backupService.save(userId, backupOf(dto), {
      ...(await ownerProofOf(userId, dto)),
      identityPublicKey: dto.identityPublicKey,
    });
  }

  @Get('keys/:userId')
  getPublicKey(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.chatService.getPublicKey(userId);
  }

  /** A new PIN replaces the backup, which needs the same proof as `resetKeys`. */
  @Post('backup')
  async setBackup(@CurrentUserId() userId: string, @Body() dto: SetBackupDto) {
    return this.backupService.save(
      userId,
      backupOf(dto),
      await ownerProofOf(userId, dto),
    );
  }

  @Get('backup')
  async getBackup(@CurrentUserId() userId: string) {
    try {
      await this.backupRateLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.backupService.describe(userId);
  }

  /** The encrypted key, for the right PIN proof only. `403` wrong PIN, `429` locked. */
  @Post('backup/unlock')
  @HttpCode(HttpStatus.OK)
  unlockBackup(@CurrentUserId() userId: string, @Body() dto: UnlockBackupDto) {
    return this.backupService.unlock(userId, dto.backupVerifier);
  }

  /** The main list by default; `?list=archived` for the archive. Paged with `limit`. */
  @Get('conversations')
  async getConversations(
    @CurrentUserId() userId: string,
    @Query() query: ConversationListQuery,
  ) {
    const conversations = await this.chatService.getConversations(
      userId,
      query.list ?? 'main',
    );
    if (query.limit === undefined) return conversations;
    return pageOfConversations(conversations, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Post('conversations/:participantId/archive')
  @HttpCode(HttpStatus.OK)
  async archiveConversation(
    @CurrentUserId() userId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    await this.conversationStates.archive(userId, participantId);
    this.gateway.notifyConversationChanged(userId, participantId, {
      historyCleared: false,
    });
    return { success: true };
  }

  @Post('conversations/:participantId/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchiveConversation(
    @CurrentUserId() userId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    await this.conversationStates.unarchive(userId, participantId);
    this.gateway.notifyConversationChanged(userId, participantId, {
      historyCleared: false,
    });
    return { success: true };
  }

  /** For the caller only, or with `forEveryone` for both people, permanently. */
  @Post('conversations/:participantId/delete')
  @HttpCode(HttpStatus.OK)
  async deleteConversation(
    @CurrentUserId() userId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: DeleteConversationDto,
  ) {
    const forEveryone = dto.forEveryone === true;
    if (forEveryone) {
      await this.conversationStates.deleteForEveryone(userId, participantId);
    } else {
      await this.conversationStates.deleteForMe(userId, participantId);
    }
    this.gateway.notifyConversationChanged(userId, participantId, {
      historyCleared: true,
      forPartner: forEveryone,
    });
    return { success: true };
  }

  /** The newest page of a conversation, oldest message first. */
  @Get('messages/:participantId')
  getMessagesWith(
    @CurrentUserId() userId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Query() page: MessagePageQuery,
  ) {
    return this.chatService.getMessagesWith(
      userId,
      participantId,
      page.limit ?? DEFAULT_PAGE_SIZE,
      page.before,
    );
  }

  @Post('messages/:participantId/read')
  markAsRead(
    @CurrentUserId() userId: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    return this.chatService.markAsRead(userId, participantId);
  }

  /** Where to upload one encrypted file for `recipientId`: `{ path, uploadUrl }`. */
  @Post('attachments')
  async createAttachmentUpload(
    @CurrentUserId() userId: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    try {
      await this.uploadRateLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.attachmentService.createUpload(userId, dto.recipientId);
  }

  /** A one-minute download link, for the sender or the recipient only. */
  @Get('attachments/:senderId/:recipientId/:fileId')
  getAttachmentDownloadUrl(
    @CurrentUserId() userId: string,
    @Param('senderId', ParseUUIDPipe) senderId: string,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.attachmentService.createDownloadUrl(userId, {
      senderId,
      recipientId,
      fileId,
    });
  }
}

/** How the caller shows the backup is theirs to replace: the account password, else the current PIN. */
async function ownerProofOf(
  userId: string,
  dto: BackupOwnerProofDto,
): Promise<BackupOwnerProof> {
  if (dto.passwordProofToken) {
    await requirePasswordProof(userId, dto.passwordProofToken);
    return { provenByPassword: true };
  }
  return { currentVerifier: dto.currentBackupVerifier };
}

function backupOf(dto: SetBackupDto): NewKeyBackup {
  return {
    blob: dto.backupBlob,
    salt: dto.backupSalt,
    nonce: dto.backupNonce,
    verifier: dto.backupVerifier,
    protectedBy: dto.protectedBy,
  };
}
