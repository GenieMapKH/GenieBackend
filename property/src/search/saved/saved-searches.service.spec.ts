import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import {
  MAX_SAVED_SEARCHES,
  SavedSearchesService,
} from './saved-searches.service';

const AREA = { minLat: 11.5, maxLat: 11.6, minLng: 104.8, maxLng: 104.95 };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  userId: 'u',
  name: 'Toul Kork houses',
  ...AREA,
  propertyType: 'House',
  listingTypes: ['Sale'],
  minPrice: new Prisma.Decimal(100000),
  maxPrice: null,
  minSize: null,
  maxSize: new Prisma.Decimal('250.5'),
  keywords: [],
  alerts: true,
  createdAt: new Date('2026-10-24T00:00:00Z'),
  ...overrides,
});

describe('SavedSearchesService', () => {
  const prisma = {
    savedSearch: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  let service: SavedSearchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SavedSearchesService(prisma as never);
    prisma.savedSearch.count.mockResolvedValue(0);
    prisma.savedSearch.create.mockResolvedValue(row());
  });

  it('saves the area and filter, without repeats, alerting by default', async () => {
    const saved = await service.create('u', {
      name: 'Toul Kork houses',
      ...AREA,
      propertyType: 'House',
      listingTypes: ['Sale', 'Sale'],
      minPrice: 100000,
      keywords: ['near_school', 'near_school'],
    });

    expect(prisma.savedSearch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u',
        listingTypes: ['Sale'],
        keywords: ['near_school'],
        maxPrice: null,
        alerts: true,
      }) as object,
    });
    // Prices and sizes go out as plain numbers.
    expect(saved.minPrice).toBe(100000);
    expect(saved.maxSize).toBe(250.5);
    expect(saved.maxPrice).toBeNull();
  });

  it.each([
    ['latitude', { minLat: 12, maxLat: 11 }],
    ['price', { minPrice: 500, maxPrice: 100 }],
    ['size', { minSize: 50, maxSize: 10 }],
  ])('refuses a %s range that is upside down', async (_what, range) => {
    await expect(
      service.create('u', { name: 'x', ...AREA, ...range }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.savedSearch.create).not.toHaveBeenCalled();
  });

  it(`keeps at most ${MAX_SAVED_SEARCHES} per person`, async () => {
    prisma.savedSearch.count.mockResolvedValue(MAX_SAVED_SEARCHES);
    await expect(service.create('u', { name: 'x', ...AREA })).rejects.toThrow(
      ConflictException,
    );
  });

  it("changes only the owner's own, and only name and alerts", async () => {
    prisma.savedSearch.updateMany.mockResolvedValue({ count: 1 });
    prisma.savedSearch.findUniqueOrThrow.mockResolvedValue(
      row({ alerts: false }),
    );

    await expect(
      service.update('u', 's1', { alerts: false }),
    ).resolves.toMatchObject({ alerts: false });
    expect(prisma.savedSearch.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u' },
      data: { alerts: false },
    });
  });

  it("says someone else's is not found", async () => {
    prisma.savedSearch.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('u', 's1', { name: 'y' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("removes only the owner's own", async () => {
    await service.remove('u', 's1');
    expect(prisma.savedSearch.deleteMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u' },
    });
  });
});
