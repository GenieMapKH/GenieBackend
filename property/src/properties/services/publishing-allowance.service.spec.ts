import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';
import { PublishingAllowanceService } from './publishing-allowance.service';

describe('PublishingAllowanceService', () => {
  const tx = { $executeRaw: jest.fn(), property: { count: jest.fn() } };
  const prisma = { $transaction: jest.fn((run) => run(tx)) };
  const service = new PublishingAllowanceService(prisma as never);
  let call: jest.SpyInstance;
  const write = jest.fn().mockResolvedValue({ status: 'Active' });

  beforeEach(() => {
    jest.clearAllMocks();
    call = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockResolvedValue({ listingLimit: 1, expiresAt: null });
    tx.property.count.mockResolvedValue(0);
  });
  afterEach(() => call.mockRestore());

  it('allows the first property under an account lock', async () => {
    await expect(service.publish('alice', write)).resolves.toEqual({
      status: 'Active',
    });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.property.count).toHaveBeenCalledWith({
      where: { userId: 'alice', status: { in: ['Active', 'Pending'] } },
    });
    expect(write).toHaveBeenCalledWith(tx);
  });

  it('refuses the second free property without writing it', async () => {
    tx.property.count.mockResolvedValue(1);
    try {
      await service.publish('alice', write);
      throw new Error('Should refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'PUBLISHING_PLAN_REQUIRED',
      });
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('rechecks an entitlement that expired while waiting for the lock', async () => {
    call.mockResolvedValue({
      listingLimit: 50,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    tx.property.count.mockResolvedValue(1);
    await expect(service.publish('alice', write)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('fails closed when payment cannot verify the account plan', async () => {
    call.mockRejectedValue(new Error('unreachable'));
    await expect(service.publish('alice', write)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
