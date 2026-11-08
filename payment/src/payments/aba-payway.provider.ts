import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  CheckoutRequest,
  PaymentProvider,
  ProviderCheckout,
  ProviderTransaction,
  ProviderWebhook,
} from './payment-provider.interface';

/** Live adapter fails closed until ABA purchase and verification are implemented. */
@Injectable()
export class AbaPaywayProvider implements PaymentProvider {
  readonly name = 'ABA_PAYWAY';

  initiateCheckout(_request: CheckoutRequest): Promise<ProviderCheckout> {
    throw new NotImplementedException('ABA PayWay is not integrated yet');
  }

  checkTransaction(_request: CheckoutRequest): Promise<ProviderTransaction> {
    throw new NotImplementedException(
      'ABA PayWay verification is not integrated yet',
    );
  }

  verifyWebhook(_webhook: ProviderWebhook, _signature: string): boolean {
    return false;
  }
}
