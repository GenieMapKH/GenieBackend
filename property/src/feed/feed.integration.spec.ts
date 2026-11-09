import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { Prisma } from '@tilomnov/prisma-client';
import { FeedCursor, decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { FeedFilters, FeedSort } from './feed-filters';
import { nextFeedPositions } from './feed-listing-ids';

/** Opt-in database check. All synthetic rows live in one rolled-back transaction. */
const database = process.env.FEED_TEST_DATABASE_URL;
const integration = database ? describe : describe.skip;

integration('feed filters (PostgreSQL)', () => {
  const client = new Client({
    connectionString: database,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  const [owner, hidden, outsider, saver] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  const [a, b, c, d, fraction, hiddenListing, outsiderListing, draft] =
    Array.from({ length: 8 }, () => randomUUID());
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Prisma.sql(strings, ...values);
      return (await client.query(query.text, query.values)).rows;
    },
  };

  beforeAll(async () => {
    await client.connect();
    await client.query('BEGIN');
    for (const id of [owner, hidden, outsider, saver]) {
      await client.query(
        `INSERT INTO account.users (id, email, password_hash)
        VALUES ($1, $2, 'feed-test-only')`,
        [id, `${id}@example.invalid`],
      );
    }
    await client.query(
      'UPDATE account.users SET deactivated_at = now() WHERE id = $1',
      [hidden],
    );
    const listings = [
      [a, owner, 'House', 200, '2026-11-08T10:00:00Z', 'percent', 25, 'Active'],
      [b, owner, 'House', 150, '2026-11-07T10:00:00Z', null, null, 'Active'],
      [c, owner, 'Land', 50, '2026-11-06T10:00:00Z', null, null, 'Active'],
      [d, owner, 'House', 300, '2026-11-09T10:00:00Z', 'amount', 100, 'Active'],
      [
        fraction,
        owner,
        'House',
        199.99,
        '2026-11-05T10:00:00Z',
        'percent',
        7.25,
        'Active',
      ],
      [
        hiddenListing,
        hidden,
        'House',
        1,
        '2026-11-10T10:00:00Z',
        null,
        null,
        'Active',
      ],
      [
        outsiderListing,
        outsider,
        'House',
        1,
        '2026-11-10T10:00:00Z',
        null,
        null,
        'Active',
      ],
      [draft, owner, 'House', 1, '2026-11-10T10:00:00Z', null, null, 'Draft'],
    ];
    for (const values of listings) {
      await client.query(
        `INSERT INTO listing.properties
        (id, user_id, property_type, price, published_at, discount_type, discount_value, status, title, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Feed filter test', now())`,
        values,
      );
    }
    for (const [user, property] of [
      [owner, a],
      [saver, a],
      [saver, b],
    ]) {
      await client.query(
        'INSERT INTO listing.property_favorites (user_id, property_id) VALUES ($1, $2)',
        [user, property],
      );
    }
  }, 30000);

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  const expected = (sort: FeedSort) =>
    ({
      newest: [d, a, b, c, fraction],
      top: [a, b, d, c, fraction],
      priceLow: [c, a, b, fraction, d],
      priceHigh: [d, fraction, a, b, c],
    })[sort];

  it.each(['newest', 'top', 'priceLow', 'priceHigh'] as const)(
    '%s stays ordered across one-item pages',
    async (sort) => {
      const seen: string[] = [];
      let after: FeedCursor | undefined;
      for (let page = 0; page < 6; page++) {
        const positions = await nextFeedPositions(
          prisma as never,
          [owner, hidden],
          2,
          3,
          after,
          { sort },
        );
        const first = positions[0];
        if (!first) break;
        seen.push(first.id);
        after = decodeFeedCursor(encodeFeedCursor({ ...first, sort }));
        if (positions.length < 2) break;
      }
      expect(seen).toEqual(expected(sort));
      expect(new Set(seen).size).toBe(seen.length);
    },
  );

  it.each(['newest', 'top', 'priceLow', 'priceHigh'] as const)(
    '%s combines date, category and discounted-price bounds',
    async (sort) => {
      const filters: FeedFilters = {
        sort,
        propertyType: 'House',
        minPrice: 150,
        maxPrice: 150,
        since: '2026-11-07T10:00:00Z',
        until: '2026-11-09T10:00:00Z',
      };
      const result = await nextFeedPositions(
        prisma as never,
        [owner, hidden],
        20,
        3,
        undefined,
        filters,
      );
      expect(result.map((row) => row.id)).toEqual([a, b]);
    },
  );
});
