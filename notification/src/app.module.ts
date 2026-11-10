import { Module } from '@nestjs/common';
import {
  HealthController,
  JwtStrategy,
  PrismaModule,
  RedisModule,
} from '@tilomnov/shared';
import { NotificationsModule } from './notifications/notifications.module';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';

/** The notification service: push devices, preferences, alerts from other services, promotions. */
@Module({
  imports: [SentryErrorsModule, RedisModule, PrismaModule, NotificationsModule],
  controllers: [HealthController],
  providers: [JwtStrategy],
})
export class AppModule {}
