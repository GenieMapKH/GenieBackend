import { HttpException, NotFoundException } from '@nestjs/common';
import { PropertyEngagementService } from './property-engagement.service';

/** The row a like or favorite answers with, as before. */
const STORED = {
  userId: 'u',
  propertyId: 'p1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function setup(options: { visible?: boolean; allowContact?: boolean } = {}) {
  const { visible = true, allowContact = true } = options;
  const prisma = {
    property: {
      findFirst: jest
        .fn()
        .mockResolvedValue(visible ? { userId: 'owner' } : null),
    },
    propertyLike: {
      createMany: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue(STORED),
      deleteMany: jest.fn(),
    },
    propertyFavorite: {
      createMany: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue(STORED),
      deleteMany: jest.fn(),
    },
    propertyView: { createMany: jest.fn() },
    propertyContact: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
    propertyLead: { createMany: jest.fn() },
  };
  const limiter = {
    consume: allowContact
      ? jest.fn().mockResolvedValue({})
      : jest.fn().mockRejectedValue(new Error('limit')),
  };
  const rateLimits = { create: jest.fn().mockReturnValue(limiter) };
  const service = new PropertyEngagementService(
    prisma as never,
    rateLimits as never,
  );
  return { service, prisma, limiter };
}

describe('PropertyEngagementService', () => {
  it.each([
    ['like', (s: PropertyEngagementService) => s.like('u', 'p1')],
    ['favorite', (s: PropertyEngagementService) => s.favorite('u', 'p1')],
    ['view', (s: PropertyEngagementService) => s.logView('u', 'p1')],
    [
      'contact',
      (s: PropertyEngagementService) =>
        s.contact('u', 'p1', { name: 'n', message: 'm' }),
    ],
    ['lead', (s: PropertyEngagementService) => s.recordLead('u', 'p1', 'call')],
  ])(
    '%s of a listing that is not published is 404 and writes nothing',
    async (_name, act) => {
      const { service, prisma } = setup({ visible: false });
      await expect(act(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.propertyLike.createMany).not.toHaveBeenCalled();
      expect(prisma.propertyFavorite.createMany).not.toHaveBeenCalled();
      expect(prisma.propertyView.createMany).not.toHaveBeenCalled();
      expect(prisma.propertyContact.create).not.toHaveBeenCalled();
    },
  );

  it('only looks for published listings', async () => {
    const { service, prisma } = setup();
    await service.like('u', 'p1');
    expect(prisma.property.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'p1',
      status: 'Active',
    });
  });

  it('records one view per person, in one statement', async () => {
    const { service, prisma } = setup();
    await service.logView('u', 'p1');
    expect(prisma.propertyView.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u', propertyId: 'p1' }],
      skipDuplicates: true,
    });
  });

  it.each([
    [
      'like',
      (s: PropertyEngagementService) => s.like('u', 'p1'),
      'propertyLike',
    ],
    [
      'favorite',
      (s: PropertyEngagementService) => s.favorite('u', 'p1'),
      'propertyFavorite',
    ],
  ] as const)(
    'a %s is stored once, and answers what is stored',
    async (_name, act, table) => {
      const { service, prisma } = setup();
      await expect(act(service)).resolves.toEqual(STORED);
      expect(prisma[table].createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u', propertyId: 'p1' }],
        skipDuplicates: true,
      });
      expect(prisma[table].findUniqueOrThrow).toHaveBeenCalledWith({
        where: { userId_propertyId: { userId: 'u', propertyId: 'p1' } },
      });
    },
  );

  it('does not count the owner opening their own listing', async () => {
    const { service, prisma } = setup();
    await expect(service.logView('owner', 'p1')).resolves.toEqual({
      success: true,
    });
    expect(prisma.propertyView.createMany).not.toHaveBeenCalled();
  });

  it('stores a contact message', async () => {
    const { service, prisma, limiter } = setup();
    await service.contact('u', 'p1', { name: 'n', message: 'm' });
    expect(limiter.consume).toHaveBeenCalledWith('u');
    expect(prisma.propertyContact.create).toHaveBeenCalledWith({
      data: { name: 'n', message: 'm', propertyId: 'p1', userId: 'u' },
    });
  });

  it('answers 429 and stores nothing once the contact limit is used up', async () => {
    const { service, prisma } = setup({ allowContact: false });
    const error = await service
      .contact('u', 'p1', { name: 'n', message: 'm' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(prisma.propertyContact.create).not.toHaveBeenCalled();
  });

  it('lets a user undo a like or favorite of a listing that is no longer published', async () => {
    const { service, prisma } = setup({ visible: false });
    await service.unlike('u', 'p1');
    await service.unfavorite('u', 'p1');
    expect(prisma.propertyLike.deleteMany).toHaveBeenCalled();
    expect(prisma.propertyFavorite.deleteMany).toHaveBeenCalled();
  });

  describe('recordLead', () => {
    it('records one lead per person and channel', async () => {
      const { service, prisma } = setup();

      await service.recordLead('u', 'p1', 'chat');

      expect(prisma.propertyLead.createMany).toHaveBeenCalledWith({
        data: [{ propertyId: 'p1', userId: 'u', channel: 'chat' }],
        skipDuplicates: true,
      });
    });

    it("never counts the owner's own taps", async () => {
      const { service, prisma, limiter } = setup();

      await service.recordLead('owner', 'p1', 'call');

      expect(prisma.propertyLead.createMany).not.toHaveBeenCalled();
      expect(limiter.consume).not.toHaveBeenCalled();
    });

    it('is limited like messages to owners', async () => {
      const { service, prisma } = setup({ allowContact: false });

      await expect(
        service.recordLead('u', 'p1', 'call'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.propertyLead.createMany).not.toHaveBeenCalled();
    });
  });
});
