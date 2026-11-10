import { Logger } from '@nestjs/common';
import { MeilisearchClient } from './meilisearch.client';
import {
  DocumentBatches,
  ListingDocument,
  PublisherDocument,
  SearchEngine,
} from './search-engine';

const LISTINGS = 'listings';
const PUBLISHERS = 'publishers';

/** Meilisearch's own order, then the tie-breaker of each index. */
const RANKING = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
];

const SETTINGS: Record<string, object> = {
  // A word in the title counts more than one in the description.
  [LISTINGS]: {
    searchableAttributes: ['title', 'description'],
    rankingRules: [...RANKING, 'createdAt:desc'],
  },
  [PUBLISHERS]: {
    searchableAttributes: ['name', 'username'],
    rankingRules: [...RANKING, 'listingCount:desc'],
  },
};

/**
 * Listings and publishers in Meilisearch, which splits Khmer text into
 * words, tolerates typos and ranks by relevance. Configured by
 * `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` (an admin key: it creates and
 * swaps indexes); without them search uses the database.
 */
export class MeilisearchEngine extends SearchEngine {
  private readonly logger = new Logger(MeilisearchEngine.name);

  constructor(private readonly client: MeilisearchClient | null) {
    super();
  }

  static fromEnvironment(): MeilisearchEngine {
    const url = process.env.MEILISEARCH_URL?.replace(/\/+$/, '');
    const apiKey = process.env.MEILISEARCH_API_KEY ?? '';
    return new MeilisearchEngine(
      url ? new MeilisearchClient(url, apiKey) : null,
    );
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  findListings(text: string, limit: number): Promise<string[]> {
    return this.engine.searchIds(LISTINGS, text, limit);
  }

  findPublishers(text: string, limit: number): Promise<string[]> {
    return this.engine.searchIds(PUBLISHERS, text, limit);
  }

  // Writes are queued by Meilisearch and applied within moments: not waited for.
  async saveListing(listing: ListingDocument): Promise<void> {
    await this.engine.addDocuments(LISTINGS, [listing]);
  }

  async removeListing(id: string): Promise<void> {
    await this.engine.deleteDocument(LISTINGS, id);
  }

  async savePublisher(publisher: PublisherDocument): Promise<void> {
    await this.engine.addDocuments(PUBLISHERS, [publisher]);
  }

  async removePublisher(id: string): Promise<void> {
    await this.engine.deleteDocument(PUBLISHERS, id);
  }

  async prepare(): Promise<void> {
    for (const index of [LISTINGS, PUBLISHERS]) {
      await this.createWithSettings(index);
    }
  }

  async isEmpty(): Promise<boolean> {
    return !(await this.engine.documentCount(LISTINGS));
  }

  async replaceAll(
    listings: DocumentBatches<ListingDocument>,
    publishers: DocumentBatches<PublisherDocument>,
  ): Promise<void> {
    // Named by time, so two instances reindexing at once do not collide.
    const stamp = Date.now();
    const fresh: [string, string][] = [
      [LISTINGS, `${LISTINGS}_${stamp}`],
      [PUBLISHERS, `${PUBLISHERS}_${stamp}`],
    ];
    await this.prepare();
    try {
      await this.fill(fresh[0][1], SETTINGS[LISTINGS], listings);
      await this.fill(fresh[1][1], SETTINGS[PUBLISHERS], publishers);
      await this.engine.waitFor(await this.engine.swapIndexes(fresh));
    } finally {
      // After the swap these names hold the old documents; before it, a
      // half-filled index. Either way they go.
      for (const [, temporary] of fresh) {
        await this.deleteQuietly(temporary);
      }
    }
  }

  private get engine(): MeilisearchClient {
    if (!this.client) throw new Error('Meilisearch is not configured');
    return this.client;
  }

  private async createWithSettings(index: string): Promise<void> {
    const created = await this.engine.createIndex(index);
    await this.engine.waitFor(
      created,
      (code) => code === 'index_already_exists',
    );
    await this.engine.waitFor(
      await this.engine.updateSettings(index, SETTINGS[index]),
    );
  }

  private async fill(
    index: string,
    settings: object,
    batches: AsyncIterable<object[]>,
  ): Promise<void> {
    await this.engine.waitFor(await this.engine.createIndex(index));
    const tasks = [await this.engine.updateSettings(index, settings)];
    for await (const batch of batches) {
      if (batch.length > 0)
        tasks.push(await this.engine.addDocuments(index, batch));
    }
    for (const task of tasks) await this.engine.waitFor(task);
  }

  private async deleteQuietly(index: string): Promise<void> {
    try {
      await this.engine.waitFor(
        await this.engine.deleteIndex(index),
        (code) => code === 'index_not_found',
      );
    } catch (error) {
      this.logger.warn(
        `Could not delete index ${index}: ${(error as Error).message}`,
      );
    }
  }
}
