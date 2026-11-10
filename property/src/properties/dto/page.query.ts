import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** The most rows one page holds. */
export const MAX_PAGE_SIZE = 50;

/**
 * Asks for one page of a list: `limit` rows after skipping `offset`. Without
 * `limit` the endpoint answers the whole list as a plain array, as it did
 * before pages existed, so older app builds keep working.
 */
export class PageQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  @IsOptional()
  offset?: number;
}

/** One page of a list, and where the next one starts (null after the last). */
export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}

/**
 * The page in `rows`, read with `take: limit + 1`: the extra row only tells
 * that there is another page, and is not sent.
 */
export function toPage<T>(rows: T[], offset: number, limit: number): Page<T> {
  const more = rows.length > limit;
  return {
    items: more ? rows.slice(0, limit) : rows,
    nextOffset: more ? offset + limit : null,
  };
}
