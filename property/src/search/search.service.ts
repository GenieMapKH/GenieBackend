import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PropertyQueryService } from '../properties/services/property-query.service';
import { PropertySearchService } from '../properties/services/property-search.service';
import { JsonCache } from '@tilomnov/shared';
import { PeopleSearchService } from './people-search.service';
import { nearestFirst, withMinimumSpan } from './area-geometry';
import { PlaceSessionQuery, SearchQuery } from './dto/search.query';
import { PlaceArea, PlaceProvider } from './places/place-provider';
import { TextSearchService } from './text-search.service';
import {
  MIN_SEARCH_LENGTH,
  normalizeSearchText,
  searchTerms,
} from './search-text';

const PROPERTY_LIMIT = 8;
const PEOPLE_LIMIT = 5;

/** Listings returned for a place or a person; the map shows the rest around them. */
const AREA_PROPERTY_LIMIT = 100;

/** Suggestions for a text barely change; a place's outline even less. */
const SUGGESTION_TTL_SECONDS = 60 * 60;
const PLACE_TTL_SECONDS = 24 * 60 * 60;

/**
 * The home screen's search bar: places (like a map app), published listings
 * and the people who post them, from one text.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly places: PlaceProvider,
    private readonly propertySearch: PropertySearchService,
    private readonly propertyQuery: PropertyQueryService,
    private readonly people: PeopleSearchService,
    private readonly textSearch: TextSearchService,
    private readonly cache: JsonCache,
  ) {}

  /** The three result lists for one text; empty lists for a text that is too short. */
  async search(query: SearchQuery) {
    const text = normalizeSearchText(query.q);
    if (text.length < MIN_SEARCH_LENGTH) {
      return { places: [], properties: [], people: [] };
    }

    const terms = searchTerms(text);
    const [places, properties, people] = await Promise.all([
      this.suggestPlaces(text, query),
      this.textSearch.listings(text, terms, PROPERTY_LIMIT),
      this.textSearch.people(text, terms, PEOPLE_LIMIT),
    ]);
    return { places, properties, people };
  }

  /** A suggested place and the published listings inside it, nearest its centre first. */
  async placeArea(
    placeId: string,
    query: PlaceSessionQuery,
    viewerId?: string,
  ) {
    if (!this.places.isConfigured) {
      throw new ServiceUnavailableException('Place search is not available');
    }

    const language = query.lang ?? 'en';
    const place = await this.cache.remember<PlaceArea | null>(
      `search:place:${language}:${placeId}`,
      PLACE_TTL_SECONDS,
      () => this.lookUpPlace(placeId, language, query.session),
    );
    if (!place) {
      throw new NotFoundException('Place not found');
    }

    const area = withMinimumSpan(place.viewport, place.center);
    const inside = await this.propertyQuery.searchMap(area, viewerId);
    return {
      place: { ...place, viewport: area },
      properties: nearestFirst(inside, place.center, AREA_PROPERTY_LIMIT),
    };
  }

  /** A person who posts listings, and those listings, newest first. */
  async publisher(userId: string) {
    const [person, properties] = await Promise.all([
      this.people.findProfile(userId),
      this.propertySearch.byOwner(userId, AREA_PROPERTY_LIMIT),
    ]);
    return { person, properties };
  }

  private async lookUpPlace(
    placeId: string,
    language: string,
    sessionToken?: string,
  ) {
    try {
      return await this.places.area(placeId, { language, sessionToken });
    } catch (error) {
      this.logger.warn(`Place lookup failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Place search is not available right now',
      );
    }
  }

  /**
   * Never fails the whole search: when the provider is slow or down, the
   * listings and people still come back, without places.
   */
  private async suggestPlaces(text: string, query: SearchQuery) {
    if (!this.places.isConfigured) return [];

    const language = query.lang ?? 'en';
    // Rounded to ~10 km, so people searching from the same city share entries.
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: round1(query.lat), lng: round1(query.lng) }
        : undefined;
    const key = `search:places:${language}:${near ? `${near.lat},${near.lng}` : '-'}:${text}`;

    try {
      return await this.cache.remember(key, SUGGESTION_TTL_SECONDS, () =>
        this.places.suggest(text, {
          language,
          near,
          sessionToken: query.session,
        }),
      );
    } catch (error) {
      this.logger.warn(`Place suggestions failed: ${(error as Error).message}`);
      return [];
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
