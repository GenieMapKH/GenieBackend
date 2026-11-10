import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from './page.query';

/** How saved listings can be ordered: as saved (newest first), by listing age, or by price. */
export const FAVORITE_SORTS = [
  'saved',
  'newest',
  'priceHigh',
  'priceLow',
] as const;
export type FavoriteSort = (typeof FAVORITE_SORTS)[number];

export class FavoritesPageQuery extends PageQuery {
  @IsIn(FAVORITE_SORTS)
  @IsOptional()
  sort?: FavoriteSort;
}
