/**
 * A published listing as the search engine holds it: only what is matched
 * or ranked on. Results are read back from the database by id, so nothing
 * shown to anyone comes from here.
 */
export interface ListingDocument {
  id: string;
  title: string;
  description: string;
  propertyType: string | null;
  listingType: string | null;
  /** Milliseconds since 1970: newer first among equally good matches. */
  createdAt: number;
}

/** Someone with published listings, as the engine holds them: no contact details. */
export interface PublisherDocument {
  id: string;
  name: string | null;
  username: string | null;
  /** Their published listings: busier publishers first among equal matches. */
  listingCount: number;
}

/** Documents handed over a batch at a time, so a full reindex never holds every listing at once. */
export type DocumentBatches<T> = AsyncIterable<T[]>;

/**
 * A full-text search engine for listings and publishers. Search knows only
 * this contract, so the engine can be swapped without touching it; with none
 * configured, search uses the database as before.
 */
export abstract class SearchEngine {
  /** False when no engine is set up: nothing here may then be called. */
  abstract readonly isConfigured: boolean;

  /** Ids of the listings matching `text`, best first. */
  abstract findListings(text: string, limit: number): Promise<string[]>;

  /** Ids of the publishers matching `text`, best first. */
  abstract findPublishers(text: string, limit: number): Promise<string[]>;

  abstract saveListing(listing: ListingDocument): Promise<void>;
  abstract removeListing(id: string): Promise<void>;
  abstract savePublisher(publisher: PublisherDocument): Promise<void>;
  abstract removePublisher(id: string): Promise<void>;

  /** Creates the indexes and their settings when missing; harmless to repeat. */
  abstract prepare(): Promise<void>;

  /** True when no listing is indexed yet (a new engine, or one that lost its data). */
  abstract isEmpty(): Promise<boolean>;

  /**
   * Replaces everything indexed with these documents in one step: searches
   * see the old index until the new one is complete, and nothing left out
   * of it survives.
   */
  abstract replaceAll(
    listings: DocumentBatches<ListingDocument>,
    publishers: DocumentBatches<PublisherDocument>,
  ): Promise<void>;
}
