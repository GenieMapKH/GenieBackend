import { Module } from '@nestjs/common';
import { AbaPaywayProvider } from './aba-payway.provider';
import { PaymentCheckoutService } from './payment-checkout.service';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { PropertyPublishingClient } from './property/property-publishing.client';
import { SubscriptionService } from './subscription.service';
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
    PaymentCheckoutService,
    PaymentWebhookService,
    PropertyPublishingClient,
    SubscriptionService,
  ],
})
export class PaymentsModule {}
