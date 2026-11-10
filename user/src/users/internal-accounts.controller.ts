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
import { InternalCallGuard } from './internal-call.guard';
import { AccountContentService } from './account-content.service';

/**
 * Called by the authentication service only, never by the app: the gateway
 * does not forward `/internal`, and `InternalCallGuard` checks who is asking.
 */
@ApiExcludeController()
@UseGuards(InternalCallGuard)
@Controller({ path: 'internal/accounts/:userId', version: VERSION_NEUTRAL })
export class InternalAccountsController {
  constructor(private readonly content: AccountContentService) {}

  /** The account is being deleted: remove its files, and what is cached about it. */
  @Delete('files')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eraseFiles(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.content.eraseFiles(userId);
    await this.content.visibilityChanged(userId);
  }

  /** The account was deactivated or came back. */
  @Post('visibility-changed')
  @HttpCode(HttpStatus.NO_CONTENT)
  visibilityChanged(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.content.visibilityChanged(userId);
  }
}
