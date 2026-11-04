import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard, RateLimit, RateLimits } from '@tilomnov/shared';
import {
  PlaceIdParam,
  PlaceSessionQuery,
  SearchQuery,
} from './dto/search.query';
import { ContactDetailsInterceptor } from '../properties/contact-details';
import { SearchService } from './search.service';

type MaybeSignedIn = { user?: { userId: string } | null };

/**
 * The home screen's search. Public: guests browse the map too. A signed-in
 * caller is counted by account, a guest by address (written by the gateway).
 * Guests see no phone or email, on listings or on a publisher's page.
 */
@ApiTags('search')
@Controller('public/search')
@UseGuards(OptionalJwtAuthGuard)
@UseInterceptors(ContactDetailsInterceptor)
export class SearchController {
  /**
   * The app waits for a pause in typing before it asks, so a person rarely
   * needs more than a few a minute. Each search can cost a paid map lookup.
   */
  private readonly limiter: RateLimit;

  constructor(
    private readonly search: SearchService,
    rateLimits: RateLimits,
  ) {
    this.limiter = rateLimits.create('search', 120, 60);
  }

  @Get()
  @ApiOperation({
    summary: 'Places, published listings and people matching `q`',
  })
  @ApiResponse({ status: 429, description: 'Too many searches' })
  async find(
    @Req() req: MaybeSignedIn,
    @Headers('x-client-ip') clientIp: string | undefined,
    @Query() query: SearchQuery,
  ) {
    await this.throttle(req, clientIp);
    return this.search.search(query);
  }

  @Get('places/:placeId')
  @ApiOperation({
    summary:
      'A suggested place, its map area, and the published listings in it',
  })
  @ApiResponse({ status: 404, description: 'Unknown place' })
  @ApiResponse({ status: 503, description: 'Place search is not available' })
  async place(
    @Req() req: MaybeSignedIn,
    @Headers('x-client-ip') clientIp: string | undefined,
    @Param() params: PlaceIdParam,
    @Query() query: PlaceSessionQuery,
  ) {
    await this.throttle(req, clientIp);
    return this.search.placeArea(params.placeId, query, req.user?.userId);
  }

  @Get('people/:userId')
  @ApiOperation({
    summary: 'Someone who posts listings, and their published listings',
  })
  @ApiResponse({ status: 404, description: 'No such publisher' })
  async publisher(
    @Req() req: MaybeSignedIn,
    @Headers('x-client-ip') clientIp: string | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.throttle(req, clientIp);
    return this.search.publisher(userId);
  }

  private async throttle(req: MaybeSignedIn, clientIp: string | undefined) {
    const key = req.user?.userId
      ? `user:${req.user.userId}`
      : `ip:${clientIp ?? 'unknown'}`;
    try {
      await this.limiter.consume(key);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
