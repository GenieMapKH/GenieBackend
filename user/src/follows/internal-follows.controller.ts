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
import { FollowsService } from './follows.service';

/**
 * Who an account follows (the feed) and who follows it (pushes about its
 * new listings), for the property service. Never reachable
 * from the app: the gateway does not forward `/internal`, and the guard
 * checks the caller's service token.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('property'))
@Controller({ path: 'internal/follows/:userId', version: VERSION_NEUTRAL })
export class InternalFollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get('following')
  following(@Param('userId', ParseUUIDPipe) userId: string): Promise<string[]> {
    return this.follows.followingIds(userId);
  }

  /** Who to tell when this account posts a listing. */
  @Get('followers')
  followers(@Param('userId', ParseUUIDPipe) userId: string): Promise<string[]> {
    return this.follows.followerIds(userId);
  }
}
