import { FavoriteListingsService } from './favorite-listings.service';

describe('saved listing availability', () => {
  const findMany = jest.fn();
  const service = new FavoriteListingsService(
    { propertyFavorite: { findMany } } as never,
    { attach: async (rows: unknown[]) => rows } as never,
  );
  beforeEach(() => findMany.mockReset());

  it('keeps withdrawn and sold cards without revealing private draft details', async () => {
    findMany.mockResolvedValue(
      ['Draft', 'Sold'].map((status) => ({
        property: { id: status, status, title: 'Saved home', price: '100' },
      })),
    );
    const page = await service.page('viewer', {
      limit: 20,
      offset: 0,
      sort: 'saved',
    });
    expect(page.items.map((row) => row.status)).toEqual(['Draft', 'Sold']);
    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      userId: 'viewer',
      property: {
        user: { deactivatedAt: null },
        status: { not: 'Deleted' },
      },
    });
    expect(query.include.property.select).not.toHaveProperty('description');
    expect(query.include.property.select).not.toHaveProperty('contactPhone');
    expect(page.items[0]).not.toHaveProperty('boundaryPoints');
    expect(query.include.property.select.user.select).not.toHaveProperty(
      'phone',
    );
  });

  it('keeps the saved ids of unavailable properties so they can still be unsaved', async () => {
    findMany.mockResolvedValue([{ propertyId: 'withdrawn' }]);
    expect(await service.ids('viewer')).toEqual(['withdrawn']);
    expect(findMany.mock.calls[0][0].where.property.status).toEqual({
      not: 'Deleted',
    });
  });
});
