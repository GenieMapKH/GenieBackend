import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUserId, RateLimit, RateLimits } from '@tilomnov/shared';
import { ChatGateway } from './chat.gateway';
import { DeleteMessageDto, EditMessageDto } from './dto/chat.dto';
import { MessageActionsService } from './message-actions.service';

/** Editing and deleting one message. Both people's devices are told at once over the socket. */
@Controller('chat/messages')
export class MessageActionsController {
  /** 60 edits or deletes per user every minute. */
  private readonly rateLimiter: RateLimit;

  constructor(
    private readonly actions: MessageActionsService,
    private readonly gateway: ChatGateway,
    rateLimits: RateLimits,
  ) {
    this.rateLimiter = rateLimits.create('chat-message-action', 60, 60);
  }

  /**
   * The sender's new text, within an hour of sending. Returns the message as
   * stored. `403` someone else's message or the hour has passed, `404` unknown.
   */
  @Post(':messageId/edit')
  @HttpCode(HttpStatus.OK)
  async edit(
    @CurrentUserId() userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    await this.limit(userId);
    const message = await this.actions.edit(userId, messageId, dto);
    this.gateway.notifyMessageEdited(message);
    return message;
  }

  /**
   * For the caller only, or with `forEveryone` (the sender's own message) for
   * both people, leaving nothing in its place. `403` someone else's message
   * for everyone, `404` unknown or already deleted.
   */
  @Post(':messageId/delete')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUserId() userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: DeleteMessageDto,
  ) {
    await this.limit(userId);
    const forEveryone = dto.forEveryone === true;
    const parties = forEveryone
      ? await this.actions.deleteForEveryone(
          userId,
          messageId,
          dto.attachmentPath,
        )
      : await this.actions.deleteForMe(userId, messageId);
    this.gateway.notifyMessageDeleted(userId, messageId, {
      ...parties,
      forEveryone,
    });
    return { success: true };
  }

  private async limit(userId: string): Promise<void> {
    try {
      await this.rateLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
