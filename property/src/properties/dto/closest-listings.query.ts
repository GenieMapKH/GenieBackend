import { IntersectionType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { MapFilter } from '../map-filter';
import { MapFilterQuery, mapFilterOf } from './map-filter.query';
import { PageQuery } from './page.query';

/**
 * One page of the listings closest to a point (the user, or the map's
 * centre when their position is unknown), passing the map filter.
 */
export class ClosestListingsQuery extends IntersectionType(
  MapFilterQuery,
  PageQuery,
) {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  filter(): MapFilter {
    return mapFilterOf(this);
  }
}
