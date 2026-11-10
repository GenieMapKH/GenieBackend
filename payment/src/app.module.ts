import { Module } from '@nestjs/common';
import { HealthController, JwtStrategy, PrismaModule } from '@tilomnov/shared';
import { PaymentsModule } from './payments/payments.module';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';

/** The payment service: starts a payment and settles it from the provider's webhook. */
@Module({
  imports: [SentryErrorsModule, PrismaModule, PaymentsModule],
  controllers: [HealthController],
  providers: [JwtStrategy],
})
export class AppModule {}
