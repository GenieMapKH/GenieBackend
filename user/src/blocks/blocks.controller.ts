import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@tilomnov/shared';
import { BlocksService } from './blocks.service';

/**
 * Blocking another user. Each route answers `{ isBlocked, canMessage }`
 * about `:id`, so the app shows the server's state after every tap.
 */
@ApiTags('blocks')
@Controller('users/:id/block')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({
    summary: 'Whether you blocked a user, and whether you can message them',
  })
  status(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blocks.status(viewerId, id);
  }

  @Put()
  @ApiOperation({
    summary:
      'Block a user: unfollows both ways, stops messages, calls and follows (twice changes nothing)',
  })
  @ApiResponse({ status: 400, description: 'You cannot block yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  block(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blocks.block(viewerId, id);
  }

  @Delete()
  @ApiOperation({ summary: 'Unblock a user (twice changes nothing)' })
  unblock(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.blocks.unblock(viewerId, id);
  }
}

/** The accounts the caller blocked, to unblock them from one list. */
@ApiTags('blocks')
@Controller('users/me/blocks')
export class BlockedAccountsController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'The accounts you blocked, newest first' })
  list(@CurrentUserId() viewerId: string) {
    return this.blocks.blockedBy(viewerId);
  }
}
