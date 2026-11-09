import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '@tilomnov/shared';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminRecordsQuery } from './admin-records.query';
import { AdminRecordsService } from './admin-records.service';

describe('admin detail lists', () => {
  const prisma = {
    user: { findMany: jest.fn() },
    report: { findMany: jest.fn() },
  };
  const dashboard = { internalGet: jest.fn() };
  const service = new AdminRecordsService(prisma as never, dashboard as never);
  beforeEach(() => jest.resetAllMocks());

  it('protects the overview, detail and health routes with the admin guard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminDashboardController),
    ).toContain(AdminGuard);
  });

  it('lists enabled accounts with an explicit safe field selection and bounded pages', async () => {
    prisma.user.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
    );
    const page = await service.list({ section: 'active-users', offset: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.nextOffset).toBe(100);
    const query = prisma.user.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      where: { role: 'user', deactivatedAt: null },
      skip: 50,
      take: 51,
    });
    expect(query.select).toMatchObject({
      username: true,
      email: true,
      phone: true,
    });
    for (const secret of [
      'passwordHash',
      'firebaseUid',
      'identityPublicKey',
      'backupBlob',
      'refreshTokens',
    ])
      expect(query.select).not.toHaveProperty(secret);
  });

  it('keeps all-account and new-account filters consistent with the overview counts', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.list({ section: 'all-users', offset: 0 });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      role: 'user',
    });
    await service.list({ section: 'new-users', offset: 0 });
    expect(
      prisma.user.findMany.mock.calls[1][0].where.createdAt.gte,
    ).toBeInstanceOf(Date);
  });

  it('shows open report information and reporter identities without querying listing tables', async () => {
    prisma.report.findMany.mockResolvedValue([{ id: 'r', reason: 'spam' }]);
    const page = await service.list({ section: 'reports', offset: 0 });
    expect(page.items).toEqual([{ id: 'r', reason: 'spam' }]);
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'open' },
        select: expect.objectContaining({
          reason: true,
          details: true,
          propertyId: true,
          reporter: expect.any(Object),
        }),
      }),
    );
  });

  it('gets payment details from their service and enriches one page with account info', async () => {
    dashboard.internalGet.mockResolvedValue({
      items: [{ userId: 'u1', tier: 'gold' }],
      nextOffset: null,
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: 'sokha' }]);
    const page = await service.list({
      section: 'subscriptions',
      offset: 0,
      tier: 'gold',
    });
    expect(dashboard.internalGet).toHaveBeenCalledWith(
      'payment',
      'PAYMENT_SERVICE_URL',
      4005,
      '/records?section=subscriptions&offset=0&tier=gold',
    );
    expect(page.items[0]).toMatchObject({ account: { username: 'sokha' } });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['u1'] },
    });
  });

  it.each([
    { section: 'passwords' },
    { section: 'all-users', offset: -1 },
    { section: 'all-users', offset: 1.5 },
    { section: 'all-users', offset: 'NaN' },
    { section: 'subscriptions', tier: 'unknown' },
  ])('rejects malformed detail requests: %p', async (input) => {
    const query = plainToInstance(AdminRecordsQuery, input);
    expect(await validate(query)).not.toHaveLength(0);
  });
});
