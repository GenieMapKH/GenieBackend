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
import { InternalAdminDashboardController } from './internal-admin-dashboard.controller';
import { AdminPaymentRecordsService } from './admin-payment-records.service';
import { AdminIncomeService } from './admin-income.service';
import { ExpiryRemindersService } from './expiry-reminders.service';

@Module({
  controllers: [
    PaymentsController,
    SubscriptionsController,
    InternalSubscriptionsController,
    InternalAdminDashboardController,
  ],
  providers: [
    AdminIncomeService,
    ExpiryRemindersService,
    AdminPaymentRecordsService,
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
