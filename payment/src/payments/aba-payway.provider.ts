import { Injectable, NotImplementedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CheckoutRequest,
  PaymentProvider,
  ProviderCheckout,
  ProviderTransactionState,
  ProviderWebhook,
} from './payment-provider.interface';

/**
 * MOCK adapter for ABA PayWay. The real API is not integrated yet: the
 * PayWay purchase / check-transaction calls it must make are written up in
 * docs/ABA_PAYWAY_INTEGRATION.md.
 *
 * The webhook is authenticated with a shared secret so the mock flow cannot be
 * abused: the caller must send `x-signature` = HMAC-SHA256(secret, "<transactionId>|<status>")
 * as hex, with the secret in PAYMENT_WEBHOOK_SECRET. Without a configured
 * secret every webhook is rejected.
 */
@Injectable()
export class AbaPaywayProvider implements PaymentProvider {
  initiateCheckout(_request: CheckoutRequest): Promise<ProviderCheckout> {
    throw new NotImplementedException('ABA PayWay is not integrated yet');
  }

  /** The mock cannot ask PayWay: only the signed webhook settles a payment. */
  checkTransaction(): Promise<ProviderTransactionState> {
    return Promise.resolve('PENDING');
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
