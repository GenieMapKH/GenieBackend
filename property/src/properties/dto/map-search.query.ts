import { IntersectionType } from '@nestjs/swagger';
import { MapFilter } from '../map-filter';
import { MapBoundsQuery } from './map-bounds.query';
import { MapFilterQuery, mapFilterOf } from './map-filter.query';

/** The visible map rectangle plus the map filter. */
export class MapSearchQuery extends IntersectionType(
  MapBoundsQuery,
  MapFilterQuery,
) {
  /** The filter part, for the services. */
  filter(): MapFilter {
    return mapFilterOf(this);
  }

  /** The rectangle part. */
  bounds() {
    return {
      minLat: this.minLat,
      maxLat: this.maxLat,
      minLng: this.minLng,
      maxLng: this.maxLng,
    };
  }
}
