import { FeedService } from './feed.service';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { readFeedSpreadHours } from './feed-spread';

const ME = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LISTING = '44444444-4444-4444-8444-444444444444';

const at = (iso: string) => new Date(iso);

/** The SQL text and values of a `$queryRaw` tagged-template call. */
function rawCall(call: unknown[]) {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join('?'), values };
}

describe('FeedService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    property: { findMany: jest.fn() },
  };
  const followed = { idsFollowedBy: jest.fn() };
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeedService(prisma as never, followed as never, 6);
    followed.idsFollowedBy.mockResolvedValue([AGENT]);
    prisma.$queryRaw.mockResolvedValue([]);
    // Cards come back in any order; the service puts them in feed order.
    prisma.property.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve([...where.id.in].reverse().map((id) => ({ id }))),
    );
  });

  it('is empty without asking the database when nobody is followed', async () => {
    followed.idsFollowedBy.mockResolvedValue([]);

    await expect(service.page(ME, { limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("reads each followed owner's newest live listings, one more than the page", async () => {
    await service.page(ME, { limit: 20 });

    expect(followed.idsFollowedBy).toHaveBeenCalledWith(ME);
    const { sql, values } = rawCall(prisma.$queryRaw.mock.calls[0]);
    expect(values).toContainEqual([AGENT]);
    expect(values.filter((value) => value === 21)).toHaveLength(2);
    expect(values).toContain(6);
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain("status = 'Active'");
    expect(sql).toContain('deactivated_at IS NULL');
    expect(sql).toContain(
      'row_number() OVER (ORDER BY published_at DESC, id ASC)',
    );
    expect(sql).toContain('ORDER BY feed_at DESC, id ASC');
  });

  it('sends the cards in feed order, card fields only', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'a', feedAt: at('2026-10-03T00:00:00.000Z') },
      { id: 'b', feedAt: at('2026-10-02T00:00:00.000Z') },
    ]);

    const page = await service.page(ME, { limit: 20 });

    expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
    const { where, select } = prisma.property.findMany.mock.calls[0][0] as {
      where: unknown;
      select: Record<string, unknown>;
    };
    expect(where).toEqual({ id: { in: ['a', 'b'] }, status: 'Active' });
    expect(select.user).toEqual({
      select: { id: true, username: true, name: true, avatarUrl: true },
    });
    expect(select).not.toHaveProperty('description');
    expect(select).not.toHaveProperty('nearbyPlaces');
  });

  it('continues after the cursor', async () => {
    const after = { feedAt: at('2026-10-01T10:00:00.000Z'), id: LISTING };

    await service.page(ME, { limit: 20, after });

    const { values } = rawCall(prisma.$queryRaw.mock.calls[0]);
    // The cursor condition is a nested SQL fragment with its own values.
    const condition = values.find(
      (value): value is { sql: string; values: unknown[] } =>
        typeof (value as { sql?: unknown })?.sql === 'string' &&
        (value as { sql: string }).sql.includes('feed_at <'),
    );
    expect(condition?.sql).toContain('feed_at <');
    expect(condition?.values).toEqual([after.feedAt, after.feedAt, LISTING]);
  });

  it('hands out the cursor of the last listing shown when there is more', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'a', feedAt: at('2026-10-03T00:00:00.000Z') },
      { id: LISTING, feedAt: at('2026-10-02T00:00:00.000Z') },
      { id: 'c', feedAt: at('2026-10-01T00:00:00.000Z') },
    ]);

    const page = await service.page(ME, { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(['a', LISTING]);
    expect(decodeFeedCursor(page.nextCursor!)).toEqual({
      feedAt: at('2026-10-02T00:00:00.000Z'),
      id: LISTING,
    });
  });

  it('keeps the cursor when a listing on the page stopped being live meanwhile', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'a', feedAt: at('2026-10-03T00:00:00.000Z') },
      { id: LISTING, feedAt: at('2026-10-02T00:00:00.000Z') },
      { id: 'c', feedAt: at('2026-10-01T00:00:00.000Z') },
    ]);
    prisma.property.findMany.mockResolvedValue([{ id: 'a' }]);

    const page = await service.page(ME, { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(['a']);
    expect(decodeFeedCursor(page.nextCursor!).id).toBe(LISTING);
  });

  it('ends the feed on the last page', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'a', feedAt: at('2026-10-03T00:00:00.000Z') },
    ]);

    const page = await service.page(ME, { limit: 2 });

    expect(page.nextCursor).toBeNull();
  });

  it.each(['top', 'priceLow', 'priceHigh'] as const)(
    'carries %s ranking values into the next cursor',
    async (sort) => {
      const first = {
        id: LISTING,
        feedAt: at('2026-11-08T00:00:00Z'),
        sortValue: '150.00000000000000000000',
      };
      prisma.$queryRaw.mockResolvedValue([first, { ...first, id: AGENT }]);
      const page = await service.page(ME, { limit: 1, sort });
      expect(decodeFeedCursor(page.nextCursor!)).toEqual({ ...first, sort });
    },
  );

  it('fails when the user service cannot say who is followed', async () => {
    followed.idsFollowedBy.mockRejectedValue(new Error('unreachable'));

    await expect(service.page(ME, { limit: 20 })).rejects.toThrow(
      'unreachable',
    );
  });
});

describe('feed cursor', () => {
  it('reads back what it wrote', () => {
    const cursor = { feedAt: at('2026-10-21T08:30:15.123Z'), id: LISTING };

    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['not base64 of anything', '!!!'],
    ['a bad date', Buffer.from(`yesterday|${LISTING}`).toString('base64url')],
    [
      'a bad id',
      Buffer.from('2026-10-21T00:00:00.000Z|1 OR 1=1').toString('base64url'),
    ],
    [
      'extra parts',
      Buffer.from(`2026-10-21T00:00:00.000Z|${LISTING}|x`).toString(
        'base64url',
      ),
    ],
    ['nothing', ''],
  ])('refuses %s with a 400', (_name, raw) => {
    expect(() => decodeFeedCursor(raw)).toThrow('Invalid cursor');
  });
});

describe('feed spread setting', () => {
  it('defaults to 3 hours', () => {
    expect(readFeedSpreadHours(undefined)).toBe(3);
    expect(readFeedSpreadHours('')).toBe(3);
  });

  it('reads a positive number', () => {
    expect(readFeedSpreadHours('12')).toBe(12);
    expect(readFeedSpreadHours('0.5')).toBe(0.5);
  });

  it.each(['0', '-3', 'abc'])('refuses "%s" at start-up', (raw) => {
    expect(() => readFeedSpreadHours(raw)).toThrow('FEED_OWNER_SPREAD_HOURS');
  });
});
