import { FakeRedis, fakeCache } from '@tilomnov/shared/testing';
import { PropertyQueryService } from './property-query.service';
import { PublicPropertyCache } from './public-property-cache.service';

/** Which client answers: public pages may read a replica; the owner's own data never does. */
describe('PropertyQueryService read routing', () => {
  const listing = { id: 'p-1', userId: 'u-1', status: 'Active', images: [] };
  const client = () => ({
    property: {
      findFirst: jest.fn().mockResolvedValue(listing),
      findMany: jest.fn().mockResolvedValue([listing]),
    },
    propertyView: { findMany: jest.fn().mockResolvedValue([]) },
  });
  let primary: ReturnType<typeof client>;
  let replica: ReturnType<typeof client>;
  let query: PropertyQueryService;

  beforeEach(() => {
    primary = client();
    replica = client();
    const counts = {
      of: jest.fn().mockResolvedValue(new Map()),
      attach: jest.fn((rows) => rows),
    };
    query = new PropertyQueryService(
      primary as never,
      new PublicPropertyCache(fakeCache(new FakeRedis())),
      counts as never,
      replica as never,
    );
  });

  it('reads a public listing page from the read client', async () => {
    await query.findPublic('p-1');

    expect(replica.property.findFirst).toHaveBeenCalled();
    expect(primary.property.findFirst).not.toHaveBeenCalled();
  });

  it('reads the public map from the read client', async () => {
    await query.searchMap({
      minLat: 11.5,
      maxLat: 11.6,
      minLng: 104.8,
      maxLng: 104.9,
    });

    expect(replica.property.findMany).toHaveBeenCalled();
    expect(primary.property.findMany).not.toHaveBeenCalled();
  });

  it("reads the owner's own listing from the primary", async () => {
    await query.findOwned('u-1', 'p-1');

    expect(primary.property.findFirst).toHaveBeenCalled();
    expect(replica.property.findFirst).not.toHaveBeenCalled();
  });
});
