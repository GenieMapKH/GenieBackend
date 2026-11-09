import { AdminReportsService } from './admin-reports.service';
describe('grouped admin reports', () => {
  const prisma = {
    report: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const platform = { property: jest.fn() };
  const service = new AdminReportsService(prisma as never, platform as never);
  beforeEach(() => jest.resetAllMocks());
  it('shows each target once with a property picture and its open report count', async () => {
    prisma.report.groupBy.mockResolvedValue([
      { propertyId: 'p1', reportedUserId: null, _count: { _all: 3 } },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
    platform.property.mockResolvedValue([
      { id: 'p1', title: 'House', images: [{ url: 'photo' }] },
    ]);
    const page = await service.groups({ offset: 0 });
    expect(page.items).toEqual([
      {
        targetType: 'property',
        targetId: 'p1',
        reportCount: 3,
        property: { id: 'p1', title: 'House', images: [{ url: 'photo' }] },
        account: null,
      },
    ]);
    expect(prisma.report.groupBy.mock.calls[0][0]).toMatchObject({
      where: { status: 'open' },
      skip: 0,
      take: 21,
    });
  });
  it('returns reporter identities and exact counts without credentials', async () => {
    prisma.report.findMany.mockResolvedValue([
      { id: 'r1', reporter: { id: 'u1', username: 'dara' } },
    ]);
    prisma.report.count.mockResolvedValue(3);
    const page = await service.detail('property', 'p1', { offset: 0 });
    expect(page).toMatchObject({
      reportCount: 3,
      reporterCount: 3,
      nextOffset: null,
    });
    const select =
      prisma.report.findMany.mock.calls[0][0].select.reporter.select;
    expect(select).toEqual({
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
    });
    await expect(
      service.detail('other', 'p1', { offset: 0 }),
    ).rejects.toThrow();
  });
  it('searches reporters before pagination while retaining the complete property totals', async () => {
    prisma.report.findMany.mockResolvedValue([]);
    prisma.report.count.mockResolvedValue(7);
    const page = await service.detail('property', 'p1', {
      offset: 50,
      q: 'Dara',
    });
    expect(page).toMatchObject({ reportCount: 7, reporterCount: 7 });
    expect(prisma.report.findMany.mock.calls[0][0]).toMatchObject({
      where: { propertyId: 'p1', status: 'open', OR: expect.any(Array) },
      skip: 50,
    });
    expect(prisma.report.count).toHaveBeenCalledWith({
      where: { propertyId: 'p1', status: 'open' },
    });
  });
});
