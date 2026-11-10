import { Injectable, Logger } from '@nestjs/common';
import { PropertySearchService } from '../properties/services/property-search.service';
import { PublicPropertyCache } from '../properties/services/public-property-cache.service';
import { SearchEngine } from './index/search-engine';
import { PeopleSearchService, PublisherSummary } from './people-search.service';

/** Khmer letters, signs and symbols. */
const KHMER = /[ក-៿᧠-᧿]/;

/**
 * The listings and people matching a typed text. The search engine ranks
 * them when there is one; the database finds them when there is none, or
 * when it fails. Either way the results are read from the database, so they
 * look exactly the same and only what is published now can appear.
 */
@Injectable()
export class TextSearchService {
  private readonly logger = new Logger(TextSearchService.name);

  constructor(
    private readonly engine: SearchEngine,
    private readonly propertySearch: PropertySearchService,
    private readonly peopleSearch: PeopleSearchService,
    private readonly publicCache: PublicPropertyCache,
  ) {}

  /** `text` normalized (see `normalizeSearchText`), `terms` its words. */
  listings(text: string, terms: string[], limit: number) {
    const fromDatabase = () => this.propertySearch.matching(terms, limit);
    if (!this.engine.isConfigured) return fromDatabase();

    return this.publicCache.textSearch(`engine:${limit}:${text}`, async () => {
      const ids = await this.idsOrNull('listings', () =>
        this.engine.findListings(text, limit),
      );
      if (ids === null) return fromDatabase();
      const found = await this.propertySearch.byIds(ids);
      return toppedUp(text, found, limit, fromDatabase);
    });
  }

  async people(
    text: string,
    terms: string[],
    limit: number,
  ): Promise<PublisherSummary[]> {
    const fromDatabase = () => this.peopleSearch.matching(terms, limit);
    if (!this.engine.isConfigured) return fromDatabase();

    const ids = await this.idsOrNull('people', () =>
      this.engine.findPublishers(text, limit),
    );
    if (ids === null) return fromDatabase();
    const found = await this.peopleSearch.byIds(ids);
    return toppedUp(text, found, limit, fromDatabase);
  }

  /** The engine's answer, or null when it failed (the database answers instead). */
  private async idsOrNull(
    what: string,
    find: () => Promise<string[]>,
  ): Promise<string[] | null> {
    try {
      return await find();
    } catch (error) {
      this.logger.warn(
        `Searching ${what} fell back to the database: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

/**
 * The engine finds Khmer words and the start of words, but not a word's end
 * inside a longer one (ពេញ in ភ្នំពេញ), as the database's search did. A short
 * answer to Khmer text is filled up from the database, so nothing found
 * before goes missing.
 */
async function toppedUp<T extends { id: string }>(
  text: string,
  found: T[],
  limit: number,
  more: () => Promise<T[]>,
): Promise<T[]> {
  if (found.length >= limit || !KHMER.test(text)) return found;
  const shown = new Set(found.map((item) => item.id));
  const extra = (await more()).filter((item) => !shown.has(item.id));
  return [...found, ...extra].slice(0, limit);
}
