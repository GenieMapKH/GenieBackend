import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { ChatAttachmentService } from './chat-attachment.service';

/**
 * What the chat service keeps for an account, acted on when the user service
 * says the account was hidden, restored or deleted. Called by that service
 * only, never by the app: the gateway does not forward `/internal`.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/accounts/:userId', version: VERSION_NEUTRAL })
export class InternalAccountsController {
  constructor(private readonly attachments: ChatAttachmentService) {}

  /** The account is being deleted: remove the files it sent and received. */
  @Delete('files')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eraseFiles(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.attachments.removeAllOf(userId);
  }

  /** Compatibility endpoint for account lifecycle callers; chat reads check account visibility. */
  @Post('visibility-changed')
  @HttpCode(HttpStatus.NO_CONTENT)
  visibilityChanged(
    @Param('userId', ParseUUIDPipe) _userId: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}
