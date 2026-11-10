import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const LISTING = '33333333-3333-4333-8333-333333333333';

const prismaError = (code: string) => Object.assign(new Error(code), { code });

describe('ReportsService', () => {
  const prisma = {
    report: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const limiter = { consume: jest.fn() };
  const rateLimits = { create: () => limiter };
  let service: ReportsService;
  const receipt = { id: 'r1', status: 'open', createdAt: new Date() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(prisma as never, rateLimits as never);
    limiter.consume.mockResolvedValue(undefined);
    prisma.report.create.mockResolvedValue(receipt);
  });

  describe('create', () => {
    it('stores a listing report with trimmed details', async () => {
      await expect(
        service.create(ME, {
          targetType: 'listing',
          targetId: LISTING,
          reason: 'scam',
          details: '  asks for a deposit first  ',
        }),
      ).resolves.toBe(receipt);
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            reporterId: ME,
            propertyId: LISTING,
            reason: 'scam',
            details: 'asks for a deposit first',
          },
        }),
      );
    });

    it('stores an account report without empty details', async () => {
      await service.create(ME, {
        targetType: 'user',
        targetId: THEM,
        reason: 'harassment',
        details: '   ',
      });
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportedUserId: THEM,
            details: null,
          }) as object,
        }),
      );
    });

    it('answers the open report again instead of a second one', async () => {
      prisma.report.create.mockRejectedValue(prismaError('P2002'));
      prisma.report.findFirst.mockResolvedValue(receipt);

      await expect(
        service.create(ME, {
          targetType: 'user',
          targetId: THEM,
          reason: 'spam',
        }),
      ).resolves.toBe(receipt);
      expect(prisma.report.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reporterId: ME, status: 'open', reportedUserId: THEM },
        }),
      );
    });

    it('says a missing target is not found', async () => {
      prisma.report.create.mockRejectedValue(prismaError('P2003'));
      await expect(
        service.create(ME, {
          targetType: 'listing',
          targetId: LISTING,
          reason: 'spam',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses reporting yourself', async () => {
      await expect(
        service.create(ME, {
          targetType: 'user',
          targetId: ME,
          reason: 'spam',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('refuses a flood of reports', async () => {
      limiter.consume.mockRejectedValue(new Error('limit'));
      const refusal = service.create(ME, {
        targetType: 'listing',
        targetId: LISTING,
        reason: 'spam',
      });
      await expect(refusal).rejects.toThrow(HttpException);
      await expect(refusal).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('queue', () => {
    it('reads open reports oldest first, with a cursor to the next page', async () => {
      prisma.report.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      await expect(service.queue({ limit: 2 })).resolves.toEqual({
        items: [{ id: 'a' }, { id: 'b' }],
        nextCursor: 'b',
      });
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'open' }, take: 3 }),
      );
    });

    it('continues after the cursor', async () => {
      prisma.report.findMany.mockResolvedValue([{ id: 'c' }]);
      await expect(
        service.queue({ status: 'dismissed', cursor: 'b' }),
      ).resolves.toEqual({ items: [{ id: 'c' }], nextCursor: null });
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'dismissed' },
          cursor: { id: 'b' },
          skip: 1,
        }),
      );
    });
  });

  describe('review', () => {
    it('closes an open report, naming the admin', async () => {
      prisma.report.updateMany.mockResolvedValue({ count: 1 });
      prisma.report.findUnique.mockResolvedValue({
        id: 'r1',
        status: 'resolved',
      });

      await expect(
        service.review(THEM, 'r1', { status: 'resolved', note: ' removed ' }),
      ).resolves.toEqual({ id: 'r1', status: 'resolved' });
      expect(prisma.report.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'open' },
        data: expect.objectContaining({
          status: 'resolved',
          reviewNote: 'removed',
          reviewedBy: THEM,
        }) as object,
      });
    });

    it('does not close a report twice', async () => {
      prisma.report.updateMany.mockResolvedValue({ count: 0 });
      prisma.report.findUnique.mockResolvedValue({
        id: 'r1',
        status: 'dismissed',
      });
      await expect(
        service.review(THEM, 'r1', { status: 'resolved' }),
      ).rejects.toThrow(ConflictException);
    });

    it('says an unknown report is not found', async () => {
      prisma.report.updateMany.mockResolvedValue({ count: 0 });
      prisma.report.findUnique.mockResolvedValue(null);
      await expect(
        service.review(THEM, 'r1', { status: 'resolved' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
