import { MeilisearchClient } from './meilisearch.client';
import { MeilisearchEngine } from './meilisearch.engine';
import { ListingDocument, PublisherDocument } from './search-engine';

/**
 * Against a real Meilisearch, only when `MEILISEARCH_TEST_URL` (and
 * `MEILISEARCH_TEST_KEY`) name one; skipped otherwise. It replaces the
 * `listings` and `publishers` indexes: never point it at a shared engine.
 *
 *   meilisearch --master-key <key> --http-addr 127.0.0.1:7711
 *   MEILISEARCH_TEST_URL=http://127.0.0.1:7711 MEILISEARCH_TEST_KEY=<key> npx jest meilisearch
 */
const url = process.env.MEILISEARCH_TEST_URL;
const maybe = url ? describe : describe.skip;

const listing = (
  id: string,
  title: string,
  description = '',
  createdAt = 0,
): ListingDocument => ({
  id,
  title,
  description,
  propertyType: 'House',
  listingType: 'Sale',
  createdAt,
});

async function* batches<T>(...items: T[][]): AsyncGenerator<T[]> {
  for (const batch of items) yield batch;
}

/** Writes are applied a moment after they are accepted. */
async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  for (let tries = 0; ; tries++) {
    const value = await read();
    if (done(value) || tries > 50) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

maybe('MeilisearchEngine (real engine)', () => {
  let engine: MeilisearchEngine;

  beforeAll(async () => {
    engine = new MeilisearchEngine(
      new MeilisearchClient(url!, process.env.MEILISEARCH_TEST_KEY ?? ''),
    );
    await engine.prepare();
    await engine.replaceAll(
      batches(
        [
          listing('kh-1', 'ផ្ទះលក់នៅភ្នំពេញ', 'ផ្ទះល្វែងមួយខ្នង ជិតផ្សារ', 1),
          listing('kh-2', 'ដីសម្រាប់លក់', 'ដីទំហំធំ នៅខេត្តកណ្ដាល', 2),
        ],
        [
          listing('en-1', 'Villa for rent', 'Quiet street near BKK1', 3),
          listing('en-2', 'Shophouse', 'Close to the villa district', 4),
        ],
      ),
      batches<PublisherDocument>([
        { id: 'u-1', name: 'Dara Sok', username: 'dara', listingCount: 3 },
      ]),
    );
  }, 60_000);

  it('finds Khmer words inside Khmer text written without spaces', async () => {
    expect(await engine.findListings('ភ្នំពេញ', 10)).toEqual(['kh-1']);
    expect(await engine.findListings('លក់', 10)).toEqual(
      expect.arrayContaining(['kh-1', 'kh-2']),
    );
  });

  it('needs every word, and tolerates a typo', async () => {
    expect(await engine.findListings('villa rent', 10)).toEqual(['en-1']);
    // Words of 5 letters or more may have one typo (shorter ones would match too much).
    expect(await engine.findListings('shophose', 10)).toEqual(['en-2']);
  });

  it('ranks a match in the title above one in the description', async () => {
    expect(await engine.findListings('villa', 10)).toEqual(['en-1', 'en-2']);
  });

  it('finds publishers by name or handle', async () => {
    expect(await engine.findPublishers('sok', 5)).toEqual(['u-1']);
    expect(await engine.findPublishers('dara', 5)).toEqual(['u-1']);
  });

  it('applies a save and a removal', async () => {
    await engine.saveListing(listing('en-3', 'Penthouse with a view'));
    expect(
      await eventually(
        () => engine.findListings('penthouse', 5),
        (ids) => ids.length > 0,
      ),
    ).toEqual(['en-3']);

    await engine.removeListing('en-3');
    expect(
      await eventually(
        () => engine.findListings('penthouse', 5),
        (ids) => ids.length === 0,
      ),
    ).toEqual([]);
  });

  it('drops whatever a full reindex leaves out, and reports emptiness', async () => {
    await engine.replaceAll(
      batches([listing('en-9', 'Warehouse')]),
      batches<PublisherDocument>(),
    );

    expect(await engine.findListings('villa', 10)).toEqual([]);
    expect(await engine.findListings('warehouse', 10)).toEqual(['en-9']);
    expect(await engine.findPublishers('dara', 5)).toEqual([]);
    expect(await engine.isEmpty()).toBe(false);

    await engine.replaceAll(
      batches<ListingDocument>(),
      batches<PublisherDocument>(),
    );
    expect(await engine.isEmpty()).toBe(true);
  }, 60_000);
});
