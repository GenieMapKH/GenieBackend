import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CheckoutRequest,
  PaymentProvider,
  ProviderCheckout,
  ProviderTransaction,
  ProviderWebhook,
} from './payment-provider.interface';
import { requireMockPayments } from './mock-payment-mode';

/** Replaces only the bank; pricing, settlement and entitlements use the same services. */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK';

  initiateCheckout(_request: CheckoutRequest): Promise<ProviderCheckout> {
    requireMockPayments();
    return Promise.resolve({});
  }

  checkTransaction(request: CheckoutRequest): Promise<ProviderTransaction> {
    requireMockPayments();
    return Promise.resolve({
      state: 'PAID',
      transactionId: request.transactionId,
      amount: request.amount,
      currency: request.currency,
    });
  }

  verifyWebhook(webhook: ProviderWebhook, signature: string): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret)
      .update(`${webhook.transactionId}|${webhook.status}`)
      .digest('hex');
    const received = Buffer.from(signature, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    return (
      received.length === wanted.length && timingSafeEqual(received, wanted)
    );
  }
}
