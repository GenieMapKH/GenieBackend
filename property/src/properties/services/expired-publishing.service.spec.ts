import { ServiceClient } from '@tilomnov/shared';
import { ExpiredPublishingService } from './expired-publishing.service';

describe('expired publishing access', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const listings = [1, 2, 3].map((n) => ({
    id: `33333333-3333-4333-8333-33333333333${n}`,
    userId,
    lat: 11.5,
    lng: 104.9,
  }));
  const tx = {
    $executeRaw: jest.fn(),
    property: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((run) => run(tx)),
    property: { groupBy: jest.fn() },
  };
  const changes = { changed: jest.fn() };
  const service = new ExpiredPublishingService(
    prisma as never,
    changes as never,
  );
  let call: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    call = jest.spyOn(ServiceClient.prototype, 'call').mockResolvedValue({
      listingLimit: 1,
      expiresAt: null,
      protectedPropertyIds: [],
    });
    tx.property.findMany.mockResolvedValue(listings);
    tx.property.updateMany.mockResolvedValue({ count: 2 });
    changes.changed.mockResolvedValue(undefined);
  });
  afterEach(() => call.mockRestore());

  it('expires excess listings, keeping the oldest free listing and refreshing public views', async () => {
    await service.reconcile(userId);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(tx.property.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        status: 'Active',
        id: { in: listings.slice(1).map((l) => l.id) },
      },
      data: { status: 'Expired' },
    });
    expect(changes.changed.mock.calls).toEqual(
      listings.slice(1).map((listing) => [listing]),
    );
  });

  it('preserves separately paid listings even when they exceed the free allowance', async () => {
    call.mockResolvedValue({
      listingLimit: 1,
      expiresAt: null,
      protectedPropertyIds: [listings[1].id, listings[2].id],
    });
    await service.reconcile(userId);
    expect(tx.property.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: 'Active', id: { in: [listings[0].id] } },
      }),
    );
  });

  it('keeps listings within a current paid allowance, including after cancellation', async () => {
    call.mockResolvedValue({
      listingLimit: 20,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      protectedPropertyIds: [],
    });
    await service.reconcile(userId);
    expect(tx.property.updateMany).not.toHaveBeenCalled();
  });

  it('uses the free allowance if expiry passes while checking the plan', async () => {
    call.mockResolvedValue({
      listingLimit: 120,
      expiresAt: new Date(Date.now() - 1).toISOString(),
      protectedPropertyIds: [],
    });
    await service.reconcile(userId);
    expect(changes.changed).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    { listingLimit: 0 },
    { listingLimit: 1, expiresAt: null, protectedPropertyIds: ['invalid'] },
  ])(
    'never hides listings on an invalid entitlement response: %j',
    async (response) => {
      call.mockResolvedValue(response);
      await expect(service.reconcile(userId)).rejects.toThrow();
      expect(tx.property.updateMany).not.toHaveBeenCalled();
    },
  );

  it('never hides listings when payment is unavailable', async () => {
    call.mockRejectedValue(new Error('payment unavailable'));
    await expect(service.reconcile(userId)).rejects.toThrow(
      'payment unavailable',
    );
    expect(tx.property.updateMany).not.toHaveBeenCalled();
  });

  it('scans owners in batches and stops its timer at shutdown', async () => {
    const worker = new ExpiredPublishingService(
      prisma as never,
      changes as never,
    );
    prisma.property.groupBy
      .mockResolvedValueOnce([{ userId }])
      .mockResolvedValueOnce([]);
    const reconcile = jest
      .spyOn(worker, 'reconcile')
      .mockResolvedValue(undefined);
    await (worker as any).run();
    expect(reconcile).toHaveBeenCalledWith(userId);
    expect(prisma.property.groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: 'Active', userId: { gt: userId } },
      }),
    );
    worker.onModuleDestroy();
  });
});
