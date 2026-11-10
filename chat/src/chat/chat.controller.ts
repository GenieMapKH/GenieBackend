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
import { ChatAttachmentService } from './chat-attachment.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { pageOfConversations } from './conversation-pages';
import { ConversationStateService } from './conversation-state.service';
import {
  ConversationListQuery,
  CreateAttachmentDto,
  DeleteConversationDto,
  MessagePageQuery,
} from './dto/chat.dto';

const DEFAULT_PAGE_SIZE = 50;

@Controller('chat')
export class ChatController {
  /** Uploads are cheap to request but cost storage: 20 per user every minute. */
  private readonly uploadRateLimiter: RateLimit;

  constructor(
    private readonly chatService: ChatService,
    private readonly attachmentService: ChatAttachmentService,
    private readonly conversationStates: ConversationStateService,
    private readonly gateway: ChatGateway,
    rateLimits: RateLimits,
  ) {
    this.uploadRateLimiter = rateLimits.create('chat-upload', 20, 60);
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
