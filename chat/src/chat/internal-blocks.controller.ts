import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MessageBus, serviceCallGuard } from '@tilomnov/shared';
import { IsUUID } from 'class-validator';
import { ChatGateway } from './chat.gateway';

export class UserBlockedEvent {
  @IsUUID() blockerId: string;
  @IsUUID() blockedId: string;
}

/**
 * Told by the user service, which owns blocking, the moment someone blocks
 * someone. Messages and calls ask about blocks each time; presence watched
 * before the block has to be cut off here. Never called by the app: the
 * gateway does not forward `/internal`.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/blocks', version: VERSION_NEUTRAL })
export class InternalBlocksController implements OnModuleInit {
  constructor(
    private readonly gateway: ChatGateway,
    @Optional() private readonly messages?: MessageBus,
  ) {}

  onModuleInit(): void {
    this.messages?.handleValidated(
      'chat.user-blocked.v1',
      UserBlockedEvent,
      (event) => {
        this.blocked(event.blockerId, event.blockedId);
        return Promise.resolve();
      },
    );
  }

  @Post(':blockerId/:blockedId')
  @HttpCode(HttpStatus.NO_CONTENT)
  blocked(
    @Param('blockerId', ParseUUIDPipe) blockerId: string,
    @Param('blockedId', ParseUUIDPipe) blockedId: string,
  ): void {
    this.gateway.separatePresence(blockerId, blockedId);
  }
}
