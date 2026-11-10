import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { MapSearchQuery } from './map-search.query';
import { MAX_MONEY } from './numeric-limits';

/**
 * A map search whose prices are counted instead of listed. Its own price
 * range is ignored: the histogram shows every price the rest allows.
 */
export class MapPriceHistogramQuery extends MapSearchQuery {
  /** The price at the slider's top (USD); the last bar holds it and above. */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(MAX_MONEY)
  upTo: number;
}
