import { FollowerAlerts } from './follower-alerts';
import { SavedListingAlerts } from './saved-listing-alerts';

const LISTING = { id: 'p1', title: 'Villa', userId: 'owner' };

function setup() {
  const prisma = {
    property: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...LISTING,
        user: { name: ' ', username: 'dara' },
      }),
      findUnique: jest.fn().mockResolvedValue(LISTING),
    },
    propertyFavorite: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ userId: 'saver1' }, { userId: 'saver2' }]),
    },
  };
  const changes = { listenToEvents: jest.fn() };
  const followers = {
    idsFollowing: jest.fn().mockResolvedValue(['fan1', 'fan2']),
  };
  const notifications = {
    followedListing: jest.fn(),
    savedListingUpdate: jest.fn(),
  };
  return { prisma, changes, followers, notifications };
}

describe('FollowerAlerts', () => {
  it("tells the owner's followers once, naming the owner", async () => {
    const { prisma, changes, followers, notifications } = setup();
    const alerts = new FollowerAlerts(
      prisma as never,
      changes as never,
      followers as never,
      notifications as never,
    );

    await alerts.listingWentLive('p1');

    expect(prisma.property.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'p1',
          followersNotifiedAt: null,
        }) as object,
      }),
    );
    expect(followers.idsFollowing).toHaveBeenCalledWith('owner');
    expect(notifications.followedListing).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', title: 'Villa' }),
      'dara',
      ['fan1', 'fan2'],
    );
  });

  it('tells nobody when they were already told', async () => {
    const { prisma, changes, followers, notifications } = setup();
    prisma.property.updateMany.mockResolvedValue({ count: 0 });
    const alerts = new FollowerAlerts(
      prisma as never,
      changes as never,
      followers as never,
      notifications as never,
    );

    await alerts.listingWentLive('p1');

    expect(followers.idsFollowing).not.toHaveBeenCalled();
    expect(notifications.followedListing).not.toHaveBeenCalled();
  });
});

describe('SavedListingAlerts', () => {
  it('tells the people who saved it of a drop, at most once a day', async () => {
    const { prisma, changes, notifications } = setup();
    const alerts = new SavedListingAlerts(
      prisma as never,
      changes as never,
      notifications as never,
    );

    await alerts.listingPriceDropped('p1', { from: 100, to: 90 });

    const claim = prisma.property.updateMany.mock.calls[0][0] as {
      where: { OR: unknown[] };
    };
    expect(claim.where.OR).toHaveLength(2);
    expect(prisma.propertyFavorite.findMany).toHaveBeenCalledWith({
      where: { propertyId: 'p1', userId: { not: 'owner' } },
      select: { userId: true },
    });
    expect(notifications.savedListingUpdate).toHaveBeenCalledWith(
      LISTING,
      { kind: 'price_drop', from: 100, to: 90 },
      ['saver1', 'saver2'],
    );
  });

  it('a second drop the same day pushes nothing', async () => {
    const { prisma, changes, notifications } = setup();
    prisma.property.updateMany.mockResolvedValue({ count: 0 });
    const alerts = new SavedListingAlerts(
      prisma as never,
      changes as never,
      notifications as never,
    );

    await alerts.listingPriceDropped('p1', { from: 90, to: 80 });

    expect(notifications.savedListingUpdate).not.toHaveBeenCalled();
  });

  it('tells them when it is sold', async () => {
    const { prisma, changes, notifications } = setup();
    const alerts = new SavedListingAlerts(
      prisma as never,
      changes as never,
      notifications as never,
    );

    await alerts.listingSold('p1');

    expect(notifications.savedListingUpdate).toHaveBeenCalledWith(
      LISTING,
      { kind: 'sold' },
      ['saver1', 'saver2'],
    );
  });
});
