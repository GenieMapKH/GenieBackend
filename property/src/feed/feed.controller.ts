import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@tilomnov/shared';
import { FeedQuery } from './dto/feed.query';
import { decodeFeedCursor } from './feed-cursor';
import { FeedService } from './feed.service';

/** Listings when no `limit` is asked for. */
const DEFAULT_PAGE_SIZE = 20;

@ApiTags('feed')
@ApiHeader({ name: 'x-user-id', description: 'User ID from API Gateway' })
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /** `{ items, nextCursor }`; send `nextCursor` back as `cursor` for the next page. */
  @Get()
  @ApiOperation({
    summary:
      'Followed listings filtered by date, category and buyer price; sort by newest, saves or price',
  })
  page(@CurrentUserId() userId: string, @Query() query: FeedQuery) {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException('Minimum price exceeds maximum price');
    }
    if (
      query.since &&
      query.until &&
      new Date(query.since) >= new Date(query.until)
    ) {
      throw new BadRequestException('Invalid date range');
    }
    const after =
      query.cursor === undefined ? undefined : decodeFeedCursor(query.cursor);
    if (after && (after.sort ?? 'newest') !== (query.sort ?? 'newest')) {
      throw new BadRequestException('Cursor does not match sort order');
    }
    return this.feed.page(userId, {
      ...query,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      after,
    });
  }
}
