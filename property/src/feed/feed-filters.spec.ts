import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { FeedController } from './feed.controller';
import { FeedQuery } from './dto/feed.query';
import { FeedCursor, decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { nextFeedPositions } from './feed-listing-ids';
import { FeedFilters } from './feed-filters';

const ID = '44444444-4444-4444-8444-444444444444';
const OWNER = '22222222-2222-4222-8222-222222222222';
const TIME = new Date('2026-11-08T10:00:00.123Z');

describe('feed filter boundary', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const query = (input: Record<string, unknown>): Promise<FeedQuery> =>
    pipe.transform(input, { type: 'query', metatype: FeedQuery });

  it('parses supported sorts, date bounds, category and numeric prices', async () => {
    const parsed = await query({
      sort: 'top',
      propertyType: 'House',
      since: '2026-11-01T00:00:00Z',
      until: '2026-11-09T00:00:00Z',
      minPrice: '0',
      maxPrice: '9999999999.99',
    });
    expect(parsed.minPrice).toBe(0);
    expect(parsed.maxPrice).toBe(9999999999.99);
    const page = jest.fn();
    await new FeedController({ page } as never).page('me', parsed);
    expect(page).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({ ...parsed, limit: 20 }),
    );
  });

  it.each([
    { sort: 'random' },
    { propertyType: "House' OR 1=1" },
    { minPrice: '-1' },
    { maxPrice: '10000000000' },
    { minPrice: 'NaN' },
    { since: 'yesterday' },
    { until: '2026-02-30' },
  ])('rejects invalid input %j', async (input) => {
    await expect(query(input)).rejects.toThrow(BadRequestException);
  });

  it.each([
    { minPrice: 200, maxPrice: 100 },
    { since: '2026-11-08', until: '2026-11-08' },
    { since: '2026-11-09', until: '2026-11-08' },
    {
      sort: 'top' as const,
      cursor: encodeFeedCursor({ feedAt: TIME, id: ID }),
    },
  ])('rejects reversed ranges and a cursor from another order %j', (input) => {
    const page = jest.fn();
    expect(() =>
      new FeedController({ page } as never).page('me', input),
    ).toThrow(BadRequestException);
    expect(page).not.toHaveBeenCalled();
  });
});

describe('feed sorting SQL', () => {
  async function sqlFor(filters: FeedFilters, after?: FeedCursor) {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await nextFeedPositions(prisma as never, [OWNER], 21, 3, after, filters);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return Prisma.sql(strings, ...values);
  }

  it('applies filters with bound values before selecting a page', async () => {
    const sql = await sqlFor({
      since: '2026-11-01T00:00:00Z',
      until: '2026-11-09T00:00:00Z',
      propertyType: 'House',
      minPrice: 100,
      maxPrice: 200,
    });
    expect(sql.text).toContain('published_at >=');
    expect(sql.text).toContain('published_at <');
    expect(sql.text).toContain('property_type =');
    expect(sql.text).toContain("discount_type = 'percent'");
    expect(sql.values).toEqual(
      expect.arrayContaining([
        'House',
        100,
        200,
        new Date('2026-11-01T00:00:00Z'),
      ]),
    );
    expect(sql.text).not.toContain('House');
    expect(sql.text.indexOf('property_type =')).toBeLessThan(
      sql.text.indexOf('ORDER BY feed_at DESC'),
    );
  });

  it('explicit newest uses actual publication time without the owner spread', async () => {
    const sql = await sqlFor({ sort: 'newest' });
    expect(sql.values).toContain(0);
    expect(sql.values).not.toContain(3);
  });

  it.each(['top', 'priceLow', 'priceHigh'] as const)(
    'paginates %s using value, date and id',
    async (sort) => {
      const cursor = {
        sort,
        sortValue: sort === 'priceLow' ? '-100.12500000000000000000' : '100',
        feedAt: TIME,
        id: ID,
      };
      expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
      const sql = await sqlFor({ sort }, cursor);
      expect(sql.text).toContain(
        'ORDER BY sort_value DESC, feed_at DESC, id ASC',
      );
      expect(sql.text).toContain('sort_value <');
      expect(sql.text).toContain('AND id >');
      expect(sql.text).toContain('deactivated_at IS NULL');
      expect(sql.values).toContain(cursor.sortValue);
      expect(sql.values).toContain(ID);
      if (sort === 'top')
        expect(sql.text).toContain('listing.property_favorites');
      else expect(sql.text).toContain("discount_type = 'amount'");
    },
  );

  it.each(['NaN', 'Infinity', '1; DROP TABLE users', '', '1e100'])(
    'rejects malformed numeric cursor value %s',
    (value) => {
      const raw = Buffer.from(
        `${TIME.toISOString()}|${ID}|top|${value}`,
      ).toString('base64url');
      expect(() => decodeFeedCursor(raw)).toThrow(BadRequestException);
    },
  );
});
