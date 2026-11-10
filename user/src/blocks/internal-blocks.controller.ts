import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { BlocksService } from './blocks.service';

/**
 * Whether two accounts may reach each other, for the chat service (messages
 * and calls). Never reachable from the app: the gateway does not forward
 * `/internal`, and the guard checks the caller's service token.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('chat'))
@Controller({
  path: 'internal/blocks/:userId/with/:otherId',
  version: VERSION_NEUTRAL,
})
export class InternalBlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  async between(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
  ): Promise<{ blocked: boolean }> {
    return { blocked: await this.blocks.eitherBlocked(userId, otherId) };
  }
}
