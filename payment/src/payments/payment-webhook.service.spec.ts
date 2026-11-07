import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentWebhookService } from './payment-webhook.service';

describe('PaymentWebhookService', () => {
  const transactionTable = { findUnique: jest.fn(), updateMany: jest.fn() };
  const prisma = { paymentTransaction: transactionTable };
  const provider = { verifyWebhook: jest.fn() };
  const property = { settle: jest.fn() };
  let service: PaymentWebhookService;

  const pending = {
    provider: 'MOCK',
    id: 'tx-1',
    propertyId: 'p-1',
    status: 'Pending',
    amount: { equals: (n: number) => n === 50 },
  };
  const webhook = { transactionId: 'tx-1', status: 'SUCCESS' as const };

  beforeEach(() => {
    process.env.PAYMENT_MODE = 'mock';
    process.env.APP_ENV = 'test';
    jest.clearAllMocks();
    provider.verifyWebhook.mockReturnValue(true);
    transactionTable.findUnique.mockResolvedValue(pending);
    transactionTable.updateMany.mockResolvedValue({ count: 1 });
    property.settle.mockResolvedValue(undefined);
    service = new PaymentWebhookService(
      prisma as never,
      provider as never,
      property as never,
    );
  });

  it('rejects an unsigned/forged webhook before touching the database', async () => {
    provider.verifyWebhook.mockReturnValue(false);

    await expect(service.handle(webhook, 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(transactionTable.findUnique).not.toHaveBeenCalled();
  });

  it('404s for an unknown transaction', async () => {
    transactionTable.findUnique.mockResolvedValue(null);

    await expect(service.handle(webhook, 'sig')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('publishes the property when the payment succeeds', async () => {
    const result = await service.handle(webhook, 'sig');

    expect(result).toEqual({ success: true });
    expect(transactionTable.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'Pending' },
      data: { status: 'Success' },
    });
    expect(property.settle).toHaveBeenCalledWith('p-1', 'Active');
  });

  it('returns the property to Draft when the payment fails', async () => {
    const result = await service.handle(
      { ...webhook, status: 'FAILED' },
      'sig',
    );

    expect(result).toEqual({ success: false });
    expect(property.settle).toHaveBeenCalledWith('p-1', 'Draft');
  });

  it('ignores a repeated webhook for an already settled transaction', async () => {
    transactionTable.findUnique.mockResolvedValue({
      ...pending,
      status: 'Success',
    });

    const result = await service.handle(webhook, 'sig');

    expect(result).toEqual({ success: true, alreadyProcessed: true });
    expect(transactionTable.updateMany).not.toHaveBeenCalled();
    expect(property.settle).not.toHaveBeenCalled();
  });

  it('does not let a late FAILED webhook undo a successful payment', async () => {
    transactionTable.findUnique.mockResolvedValue({
      ...pending,
      status: 'Success',
    });

    const result = await service.handle(
      { ...webhook, status: 'FAILED' },
      'sig',
    );

    expect(result.success).toBe(true);
    expect(property.settle).not.toHaveBeenCalled();
  });

  it('settles only once when two webhooks arrive at the same time', async () => {
    transactionTable.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.handle(webhook, 'sig');

    expect(result.alreadyProcessed).toBe(true);
    expect(property.settle).not.toHaveBeenCalled();
  });

  it('rejects a webhook whose amount differs from the transaction', async () => {
    await expect(
      service.handle({ ...webhook, amount: 1 }, 'sig'),
    ).rejects.toThrow(BadRequestException);
    expect(transactionTable.updateMany).not.toHaveBeenCalled();
  });

  describe('when the property service cannot be told', () => {
    it('fails the webhook and undoes the switch, so the provider sends it again', async () => {
      property.settle.mockRejectedValue(new ServiceUnavailableException());

      await expect(service.handle(webhook, 'sig')).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(transactionTable.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'tx-1', status: 'Success' },
        data: { status: 'Pending' },
      });
    });

    it('settles the retry normally once the property service is back', async () => {
      property.settle.mockRejectedValueOnce(new ServiceUnavailableException());
      await expect(service.handle(webhook, 'sig')).rejects.toThrow();

      const retry = await service.handle(webhook, 'sig');

      expect(retry).toEqual({ success: true });
      expect(property.settle).toHaveBeenCalledTimes(2);
    });

    it('still reports the original failure when the switch cannot be undone', async () => {
      property.settle.mockRejectedValue(new ServiceUnavailableException());
      transactionTable.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('db down'));

      await expect(service.handle(webhook, 'sig')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
