import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentWebhookService } from './payment-webhook.service';

describe('PaymentWebhookService', () => {
  const table = { findUnique: jest.fn() };
  const prisma = { paymentTransaction: table };
  const provider = { name: 'MOCK', verifyWebhook: jest.fn() };
  const gateway = { reconcile: jest.fn() };
  const service = new PaymentWebhookService(
    prisma as never,
    provider as never,
    gateway as never,
  );
  const pending = {
    id: 'tx-1',
    provider: 'MOCK',
    status: 'Pending',
    amount: { equals: (n: number) => n === 50 },
  };
  const webhook = { transactionId: 'tx-1', status: 'SUCCESS' as const };
  beforeEach(() => {
    jest.clearAllMocks();
    provider.verifyWebhook.mockReturnValue(true);
    table.findUnique.mockResolvedValue(pending);
    gateway.reconcile.mockResolvedValue({ status: 'Success' });
  });

  it('rejects forged callbacks before accessing data', async () => {
    provider.verifyWebhook.mockReturnValue(false);
    await expect(service.handle(webhook, 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(table.findUnique).not.toHaveBeenCalled();
  });
  it('rejects an unknown transaction', async () => {
    table.findUnique.mockResolvedValue(null);
    await expect(service.handle(webhook, 'sig')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('rejects a wrong provider or amount', async () => {
    await expect(
      service.handle({ ...webhook, amount: 1 }, 'sig'),
    ).rejects.toThrow(BadRequestException);
    table.findUnique.mockResolvedValue({ ...pending, provider: 'OTHER' });
    await expect(service.handle(webhook, 'sig')).rejects.toThrow(
      BadRequestException,
    );
    expect(gateway.reconcile).not.toHaveBeenCalled();
  });
  it('uses verified settlement rather than the callback claim', async () => {
    gateway.reconcile.mockResolvedValue({ status: 'Pending' });
    expect(await service.handle(webhook, 'sig')).toEqual({ success: false });
    gateway.reconcile.mockResolvedValue({ status: 'Success' });
    expect(
      await service.handle({ ...webhook, status: 'FAILED' }, 'sig'),
    ).toEqual({ success: true });
    expect(gateway.reconcile).toHaveBeenCalledWith('tx-1');
  });
  it('accepts a duplicate callback without regranting benefits', async () => {
    table.findUnique.mockResolvedValue({ ...pending, status: 'Success' });
    expect(await service.handle(webhook, 'sig')).toEqual({
      success: true,
      alreadyProcessed: true,
    });
  });
  it('propagates settlement errors so the provider can retry', async () => {
    gateway.reconcile.mockRejectedValueOnce(new Error('property unavailable'));
    await expect(service.handle(webhook, 'sig')).rejects.toThrow(
      'property unavailable',
    );
  });
});
