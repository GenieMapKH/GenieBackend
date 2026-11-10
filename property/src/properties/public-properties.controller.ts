import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '@tilomnov/shared';
import { ClosestListingsQuery } from './dto/closest-listings.query';
import { GuestSessionDto } from './dto/guest-session.dto';
import { MapPriceHistogramQuery } from './dto/map-price-histogram.query';
import { MapSearchQuery } from './dto/map-search.query';
import { ContactDetailsInterceptor } from './contact-details';
import { ClosestListingsService } from './services/closest-listings.service';
import { GuestSessionService } from './services/guest-session.service';
import { PropertyQueryService } from './services/property-query.service';

/** Listings per page of `closest` when no `limit` is asked for. */
const CLOSEST_PAGE_SIZE = 20;

/**
 * Endpoints anyone can call; a logged-in user just gets extra info
 * (`isVisited`, how to reach the owner).
 */
@ApiTags('public-properties')
@Controller('public/properties')
@UseInterceptors(ContactDetailsInterceptor)
export class PublicPropertiesController {
  constructor(
    private readonly query: PropertyQueryService,
    private readonly guestSessions: GuestSessionService,
    private readonly closest: ClosestListingsService,
  ) {}

  @Get('map')
  @UseGuards(OptionalJwtAuthGuard)
  searchMap(
    @Req() req: { user?: { userId: string } | null },
    @Query() search: MapSearchQuery,
  ) {
    return this.query.searchMap(
      search.bounds(),
      req.user?.userId,
      search.filter(),
    );
  }

  /** The bars behind the filter's price slider, for the same area and filter. */
  @Get('map/prices')
  mapPrices(@Query() search: MapPriceHistogramQuery) {
    return this.query.priceHistogram(
      search.bounds(),
      search.filter(),
      search.upTo,
    );
  }

  /**
   * `{ items, nextOffset }`: every published listing passing the map filter,
   * nearest to `lat`,`lng` first, each with its `distanceMeters`. Send
   * `nextOffset` back as `offset` for the next page.
   */
  @Get('closest')
  @UseGuards(OptionalJwtAuthGuard)
  closestListings(@Query() query: ClosestListingsQuery) {
    return this.closest.page(
      { lat: query.lat, lng: query.lng },
      query.filter(),
      {
        limit: query.limit ?? CLOSEST_PAGE_SIZE,
        offset: query.offset ?? 0,
      },
    );
  }

  @Post('guest-session')
  registerGuestSession(@Body() dto: GuestSessionDto) {
    return this.guestSessions.register(dto.deviceId);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.query.findPublic(id);
  }
}
