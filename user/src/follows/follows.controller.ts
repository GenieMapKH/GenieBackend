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
import { FollowsService, MAX_FOLLOWING } from './follows.service';

/**
 * Following another user. Each route answers the same
 * `{ followerCount, followingCount, isFollowing }` about `:id`, so the app
 * shows the server's numbers after every tap.
 */
@ApiTags('follows')
@Controller('users/:id/follow')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Follower and following counts of a user, and whether you follow them',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  summary(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.profileSummary(viewerId, id);
  }

  @Put()
  @ApiOperation({ summary: 'Follow a user (doing it twice changes nothing)' })
  @ApiResponse({ status: 400, description: 'You cannot follow yourself' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description: `Already following ${MAX_FOLLOWING} people`,
  })
  follow(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.follow(viewerId, id);
  }

  @Delete()
  @ApiOperation({
    summary: 'Stop following a user (doing it twice changes nothing)',
  })
  unfollow(
    @CurrentUserId() viewerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.unfollow(viewerId, id);
  }
}
