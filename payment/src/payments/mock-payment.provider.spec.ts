import { createHmac } from 'crypto';
import { MockPaymentProvider } from './mock-payment.provider';

const sign = (secret: string, transactionId: string, status: string) =>
  createHmac('sha256', secret)
    .update(`${transactionId}|${status}`)
    .digest('hex');

describe('MockPaymentProvider webhook verification', () => {
  const provider = new MockPaymentProvider();
  const webhook = { transactionId: 'tx-1', status: 'SUCCESS' };
  const originalSecret = process.env.PAYMENT_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = originalSecret;
  });

  it('rejects everything when no secret is configured (fails closed)', () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;

    expect(
      provider.verifyWebhook(webhook, sign('anything', 'tx-1', 'SUCCESS')),
    ).toBe(false);
    expect(provider.verifyWebhook(webhook, '')).toBe(false);
  });

  it('accepts a correctly signed webhook', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 's3cret';

    expect(
      provider.verifyWebhook(webhook, sign('s3cret', 'tx-1', 'SUCCESS')),
    ).toBe(true);
  });

  it('rejects a wrong secret, a tampered status and a missing signature', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 's3cret';

    expect(
      provider.verifyWebhook(webhook, sign('other', 'tx-1', 'SUCCESS')),
    ).toBe(false);
    expect(
      provider.verifyWebhook(
        { ...webhook, status: 'FAILED' },
        sign('s3cret', 'tx-1', 'SUCCESS'),
      ),
    ).toBe(false);
    expect(provider.verifyWebhook(webhook, '')).toBe(false);
  });
});
