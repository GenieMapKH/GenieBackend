import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NearbyRouteService } from './nearby-route.service';

const PROPERTY = '33333333-3333-4333-8333-333333333333';
const PATH = { meters: 850, polyline: 'abc' };

describe('NearbyRouteService', () => {
  const prisma = { propertyNearbyPlace: { findFirst: jest.fn() } };
  const paths = { isConfigured: true, drivePath: jest.fn() };
  const store = new Map<string, unknown>();
  const cache = {
    remember: jest.fn(
      async (key: string, _ttl: number, load: () => Promise<unknown>) => {
        if (!store.has(key)) store.set(key, await load());
        return store.get(key);
      },
    ),
  };
  let service: NearbyRouteService;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    paths.isConfigured = true;
    service = new NearbyRouteService(prisma as never, paths, cache as never);
    prisma.propertyNearbyPlace.findFirst.mockResolvedValue({
      lat: 11.6,
      lng: 104.9,
      property: { lat: 11.5, lng: 104.8 },
    });
    paths.drivePath.mockResolvedValue(PATH);
  });

  it('draws the road from the listing to the place', async () => {
    await expect(service.routeTo(PROPERTY, 'market', 0)).resolves.toEqual(PATH);

    expect(paths.drivePath).toHaveBeenCalledWith(
      { lat: 11.5, lng: 104.8 },
      { lat: 11.6, lng: 104.9 },
    );
  });

  it('only finds places of a published listing', async () => {
    await service.routeTo(PROPERTY, 'school', 2);

    expect(prisma.propertyNearbyPlace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          propertyId: PROPERTY,
          category: 'school',
          rank: 2,
          property: { status: 'Active', user: { deactivatedAt: null } },
        },
      }),
    );
  });

  it('asks the provider once per road', async () => {
    await service.routeTo(PROPERTY, 'market', 0);
    await service.routeTo(PROPERTY, 'market', 0);

    expect(paths.drivePath).toHaveBeenCalledTimes(1);
  });

  it('is a 404 for a place the listing does not have', async () => {
    prisma.propertyNearbyPlace.findFirst.mockResolvedValue(null);

    await expect(service.routeTo(PROPERTY, 'market', 9)).rejects.toThrow(
      NotFoundException,
    );
    expect(paths.drivePath).not.toHaveBeenCalled();
  });

  it('is a 404, not cached, when there is no road', async () => {
    paths.drivePath.mockResolvedValue(null);

    await expect(service.routeTo(PROPERTY, 'market', 0)).rejects.toThrow(
      NotFoundException,
    );
    expect(store.size).toBe(0);
  });

  it('is a 503 when the provider fails, and nothing is cached', async () => {
    paths.drivePath.mockRejectedValue(new Error('Routes API answered 500'));

    await expect(service.routeTo(PROPERTY, 'market', 0)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(store.size).toBe(0);
  });

  it('is a 503 without provider credentials', async () => {
    paths.isConfigured = false;

    await expect(service.routeTo(PROPERTY, 'market', 0)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
