import { ServiceClient } from '@tilomnov/shared';
import { OrderEmailClient } from './order-email.client';

describe('OrderEmailClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the authenticated mail route without supplying a recipient', async () => {
    const call = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockResolvedValue({ sent: true });
    const details = {
      userId: 'alice',
      transactionId: 'tx-1',
      item: 'gold' as const,
      amount: 8.9,
      periodStart: '2026-11-08T00:00:00.000Z',
      periodEnd: '2026-12-08T00:00:00.000Z',
    };
    await new OrderEmailClient().send(details);
    expect(call).toHaveBeenCalledWith('POST', '/internal/mail/order', {
      body: details,
      timeoutMs: 30_000,
    });
  });

  it('does not fail a saved purchase when delivery is unavailable', async () => {
    jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockRejectedValue(new Error('unavailable'));
    await expect(
      new OrderEmailClient().send({
        userId: 'alice',
        transactionId: 'tx-1',
        item: 'gold',
        amount: 8.9,
        periodStart: '2026-11-08T00:00:00.000Z',
        periodEnd: '2026-12-08T00:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });
});
