import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NEARBY_CATEGORIES, NearbyCategory } from './nearby-categories';
import { NearbyRouteService } from './nearby-route.service';

/** Public, like the listing's page that shows the nearby places. */
@ApiTags('public-properties')
@Controller('public/properties')
export class NearbyRouteController {
  constructor(private readonly routes: NearbyRouteService) {}

  /** `{ meters, polyline }`: the driving road, `polyline` encoded (precision 5). */
  @Get(':id/nearby/:category/:rank/route')
  @ApiOperation({
    summary: 'The road from a listing to one of its nearby places',
  })
  route(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('category', new ParseEnumPipe(NEARBY_CATEGORIES))
    category: NearbyCategory,
    @Param('rank', ParseIntPipe) rank: number,
  ) {
    return this.routes.routeTo(id, category, rank);
  }
}
