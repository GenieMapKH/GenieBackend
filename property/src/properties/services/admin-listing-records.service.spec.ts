import { BadRequestException } from '@nestjs/common';
import { AdminListingRecordsService } from './admin-listing-records.service';

describe('admin listing records', () => {
  const prisma = {
    property: { findMany: jest.fn() },
    propertyLead: { findMany: jest.fn() },
  };
  const service = new AdminListingRecordsService(prisma as never);
  beforeEach(() => jest.resetAllMocks());

  it('searches listings and leads before paging without removing their scope', async () => {
    prisma.property.findMany.mockResolvedValue([]);
    prisma.propertyLead.findMany.mockResolvedValue([]);
    await service.list('active-listings', 50, ' Villa ');
    expect(prisma.property.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        status: 'Active',
        OR: expect.arrayContaining([
          { title: { contains: 'Villa', mode: 'insensitive' } },
        ]),
      },
      skip: 50,
      take: 51,
    });
    await service.list('leads', 0, 'Villa');
    expect(prisma.propertyLead.findMany.mock.calls[0][0].where).toMatchObject({
      createdAt: { gte: expect.any(Date) },
      OR: [{ property: { title: { contains: 'Villa', mode: 'insensitive' } } }],
    });
    const id = 'abcdef01-1234-1234-1234-123456789abc';
    await service.list('leads', 0, id);
    expect(
      prisma.propertyLead.findMany.mock.calls[1][0].where.OR,
    ).toContainEqual({ propertyId: id });
    await expect(service.list('leads', 0, 'x'.repeat(101))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pages active listings including drafts only in the all-listings view', async () => {
    prisma.property.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, id) => ({ id })),
    );
    const page = await service.list('active-listings', 50);
    expect(page.items).toHaveLength(50);
    expect(page.nextOffset).toBe(100);
    expect(prisma.property.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'Active' },
      skip: 50,
      take: 51,
    });
    await service.list('all-listings', 0);
    expect(prisma.property.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('lists leads in the same seven-day window as the overview, with their listing', async () => {
    prisma.propertyLead.findMany.mockResolvedValue([]);
    expect(await service.list('leads', 0)).toEqual({
      items: [],
      nextOffset: null,
    });
    const query = prisma.propertyLead.findMany.mock.calls[0][0];
    expect(query.where.createdAt.gte).toBeInstanceOf(Date);
    expect(query.select).toMatchObject({
      userId: true,
      channel: true,
      property: { select: { title: true } },
    });
    expect(query.select).not.toHaveProperty('user');
  });

  it('refuses invalid sections and page offsets before reading data', async () => {
    await expect(service.list('all-listings', -1)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('all-listings', Infinity)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('users', 0)).rejects.toThrow(BadRequestException);
    expect(prisma.property.findMany).not.toHaveBeenCalled();
  });
});
