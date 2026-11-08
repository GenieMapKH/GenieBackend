import { Module } from '@nestjs/common';
import { AbaPaywayProvider } from './aba-payway.provider';
import { PaymentCheckoutService } from './payment-checkout.service';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { PropertyPublishingClient } from './property/property-publishing.client';
import { SubscriptionService } from './subscription.service';
import { OrderEmailClient } from './order-email.client';
import { PaymentGatewayService } from './payment-gateway.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentProvider } from './payment-provider.interface';
import {
  InternalSubscriptionsController,
  SubscriptionsController,
} from './subscriptions.controller';

@Module({
  controllers: [
    PaymentsController,
    SubscriptionsController,
    InternalSubscriptionsController,
  ],
  providers: [
    AbaPaywayProvider,
    MockPaymentProvider,
    {
      provide: PaymentProvider,
      useFactory: (mock: MockPaymentProvider, live: AbaPaywayProvider) =>
        process.env.PAYMENT_MODE === 'live' ? live : mock,
      inject: [MockPaymentProvider, AbaPaywayProvider],
    },
    PaymentGatewayService,
    PaymentCheckoutService,
    PaymentWebhookService,
    PropertyPublishingClient,
    SubscriptionService,
    OrderEmailClient,
  ],
})
export class PaymentsModule {}
