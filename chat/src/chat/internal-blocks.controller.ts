import {
  Controller,
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
import { ChatGateway } from './chat.gateway';

/**
 * Told by the user service, which owns blocking, the moment someone blocks
 * someone. Messages and calls ask about blocks each time; presence watched
 * before the block has to be cut off here. Never called by the app: the
 * gateway does not forward `/internal`.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/blocks', version: VERSION_NEUTRAL })
export class InternalBlocksController {
  constructor(private readonly gateway: ChatGateway) {}

  @Post(':blockerId/:blockedId')
  @HttpCode(HttpStatus.NO_CONTENT)
  blocked(
    @Param('blockerId', ParseUUIDPipe) blockerId: string,
    @Param('blockedId', ParseUUIDPipe) blockedId: string,
  ): void {
    this.gateway.separatePresence(blockerId, blockedId);
  }
}
