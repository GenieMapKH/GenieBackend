import {
  NO_ENGAGEMENT,
  PropertyEngagementCounts,
} from './property-engagement-counts.service';

describe('PropertyEngagementCounts', () => {
  const prisma = { $queryRaw: jest.fn() };
  let counts: PropertyEngagementCounts;

  beforeEach(() => {
    jest.resetAllMocks();
    counts = new PropertyEngagementCounts(prisma as never);
  });

  it('adds each listing its own counts, in the order given', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'b', favorites: 1, views: 7, contacts: 0 },
      { id: 'a', favorites: 3, views: 9, contacts: 2 },
    ]);

    const rows = await counts.attach([
      { id: 'a', title: 'Villa' },
      { id: 'b', title: 'Land' },
    ]);

    expect(rows).toEqual([
      {
        id: 'a',
        title: 'Villa',
        _count: { favorites: 3, views: 9, contacts: 2 },
      },
      {
        id: 'b',
        title: 'Land',
        _count: { favorites: 1, views: 7, contacts: 0 },
      },
    ]);
  });

  it('counts only the listings asked about, each once', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await counts.of(['a', 'b', 'a']);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [, ids] = prisma.$queryRaw.mock.calls[0];
    expect(ids).toEqual(['a', 'b']);
  });

  it('gives zeros to a listing the database returned nothing for', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const [row] = await counts.attach([{ id: 'a' }]);

    expect(row._count).toEqual(NO_ENGAGEMENT);
  });

  it('does not ask the database about no listings', async () => {
    expect(await counts.attach([])).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
