import { Injectable } from '@nestjs/common';
import { JsonCache } from '@tilomnov/shared';
import { MapFilter, mapFilterKey } from '../map-filter';

export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** What the cache needs to know of a listing that changed: whose it is, and where. */
export interface CachedListing {
  id: string;
  userId: string;
  lat: number | null;
  lng: number | null;
}

/** Reads a `CachedListing` from the database. */
export const CACHED_LISTING_SELECT = {
  id: true,
  userId: true,
  lat: true,
  lng: true,
} as const;

/** Where a listing was before it moved. */
export interface Position {
  lat: number | null;
  lng: number | null;
}

/** Entries expire quickly on their own; `changed` outdates them at once. */
const LIST_TTL_SECONDS = 30;
const DETAIL_TTL_SECONDS = 60;

/**
 * Grid lines per degree: about 1 km apart. Viewports are widened to this
 * grid so nearby map positions share an entry. The app snaps to the same grid.
 */
const GRID_STEPS_PER_DEGREE = 100;

/**
 * Far below a grid step, far above the rounding error of `degrees * 100`. A
 * value already on the grid (sent as e.g. 11.55, stored as 11.549999...)
 * stays where it is instead of growing the box by one more step.
 */
const ON_GRID_TOLERANCE = 1e-9;

/**
 * Map answers are outdated by area: a change only outdates the answers for
 * the cells (about 11 km) the listing is in, so a new listing in one city
 * leaves every other city's map cached.
 */
const CELLS_PER_DEGREE = 10;

/** A map showing more cells than this (zoomed far out) is outdated by any change. */
const MAX_CELLS_PER_MAP = 64;

/** Text searches: any edit can change which texts a listing matches. */
const TEXT_VERSION_KEY = 'properties:public:version';
/** Maps showing more than MAX_CELLS_PER_MAP cells. */
const WIDE_VERSION_KEY = 'properties:public:wide-version';

/** The smallest box on the grid that contains `bounds`. */
export function widenToGrid(bounds: MapBounds): MapBounds {
  const down = (value: number) =>
    Math.floor(value * GRID_STEPS_PER_DEGREE + ON_GRID_TOLERANCE) /
    GRID_STEPS_PER_DEGREE;
  // `+ 0` turns the -0 that rounding up a tiny negative gives into 0.
  const up = (value: number) =>
    Math.ceil(value * GRID_STEPS_PER_DEGREE - ON_GRID_TOLERANCE) /
      GRID_STEPS_PER_DEGREE +
    0;
  return {
    minLat: down(bounds.minLat),
    maxLat: up(bounds.maxLat),
    minLng: down(bounds.minLng),
    maxLng: up(bounds.maxLng),
  };
}

/**
 * Caches what every visitor sees the same way: the map search, the other
 * lists of published listings, and a listing's public page. Nothing personal
 * is stored here.
 *
 * Each list's key carries the version of what it depends on, so `changed`
 * outdates exactly those lists by counting their versions up.
 */
@Injectable()
export class PublicPropertyCache {
  constructor(private readonly cache: JsonCache) {}

  /**
   * Map answers for a box already widened with `widenToGrid`, one entry per
   * filter and `kind` (the listings, or their price histogram).
   */
  async map<T>(
    box: MapBounds,
    filter: MapFilter,
    load: () => Promise<T>,
    kind = 'map',
  ): Promise<T> {
    const cells = cellsIn(box);
    const version = cells
      ? `c${(await this.cache.getMany<number>(cells)).reduce<number>((sum, v) => sum + (v ?? 0), 0)}`
      : `w${await this.version(WIDE_VERSION_KEY)}`;
    const name =
      `${kind}:${box.minLat}:${box.maxLat}:${box.minLng}:${box.maxLng}` +
      `:${mapFilterKey(filter)}`;
    return this.cache.remember(
      `properties:list:${name}:${version}`,
      LIST_TTL_SECONDS,
      load,
    );
  }

  /**
   * Where every published listing passing `filter` is, for ranking them by
   * distance. Any change anywhere can change it, like a zoomed-out map.
   */
  async positions<T>(filter: MapFilter, load: () => Promise<T>): Promise<T> {
    const version = await this.version(WIDE_VERSION_KEY);
    return this.cache.remember(
      `properties:list:positions:${mapFilterKey(filter)}:w${version}`,
      LIST_TTL_SECONDS,
      load,
    );
  }

  /** Published listings found by a text, named by what selects them (limit, terms). */
  async textSearch<T>(name: string, load: () => Promise<T>): Promise<T> {
    const version = await this.version(TEXT_VERSION_KEY);
    return this.cache.remember(
      `properties:list:v${version}:text:${name}`,
      LIST_TTL_SECONDS,
      load,
    );
  }

  /** One owner's published listings, named by what else selects them (a limit). */
  async ownerListings<T>(
    ownerId: string,
    name: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const version = await this.version(ownerVersionKey(ownerId));
    return this.cache.remember(
      `properties:list:owner:${ownerId}:${name}:v${version}`,
      LIST_TTL_SECONDS,
      load,
    );
  }

  async detail<T>(propertyId: string, load: () => Promise<T>): Promise<T> {
    const version = await this.version(`${this.detailKey(propertyId)}:version`);
    return this.cache.remember(
      `${this.detailKey(propertyId)}:v${version}`,
      DETAIL_TTL_SECONDS,
      load,
    );
  }

  /**
   * Call after anything that changes what the public sees of a listing (new,
   * edited, published, hidden, sold, photos added): the next reader gets fresh
   * data instead of waiting for the expiry. A listing that moved also names
   * where it was, so the map there stops showing it.
   */
  async changed(listing: CachedListing, movedFrom?: Position): Promise<void> {
    const cells = new Set(
      [listing, movedFrom].flatMap((place) => (place ? cellOf(place) : [])),
    );
    await Promise.all([
      this.cache.increment(`${this.detailKey(listing.id)}:version`),
      this.cache.increment(TEXT_VERSION_KEY),
      this.cache.increment(WIDE_VERSION_KEY),
      this.cache.increment(ownerVersionKey(listing.userId)),
      ...[...cells].map((cell) => this.cache.increment(cell)),
    ]);
  }

  /** Call after a change only the listing's own page shows (its nearby places). */
  async detailChanged(propertyId: string): Promise<void> {
    await this.cache.increment(`${this.detailKey(propertyId)}:version`);
  }

  private async version(key: string): Promise<number> {
    return (await this.cache.get<number>(key)) ?? 0;
  }

  private detailKey(propertyId: string): string {
    return `properties:public:${propertyId}`;
  }
}

function ownerVersionKey(ownerId: string): string {
  return `properties:public:owner-version:${ownerId}`;
}

function cellKey(row: number, column: number): string {
  return `properties:public:cell:${row}:${column}`;
}

/** The version key of the cell a listing at `place` is in; none without a position. */
function cellOf(place: Position): string[] {
  if (place.lat == null || place.lng == null) return [];
  return [
    cellKey(
      Math.floor(place.lat * CELLS_PER_DEGREE),
      Math.floor(place.lng * CELLS_PER_DEGREE),
    ),
  ];
}

/**
 * The version keys of every cell a listing inside `box` can be in, or null
 * when there are too many to read for one map.
 */
function cellsIn(box: MapBounds): string[] | null {
  const [firstRow, lastRow] = [box.minLat, box.maxLat].map((lat) =>
    Math.floor(lat * CELLS_PER_DEGREE),
  );
  const [firstColumn, lastColumn] = [box.minLng, box.maxLng].map((lng) =>
    Math.floor(lng * CELLS_PER_DEGREE),
  );
  if (
    (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) >
    MAX_CELLS_PER_MAP
  )
    return null;

  const cells: string[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++)
      cells.push(cellKey(row, column));
  }
  return cells;
}
