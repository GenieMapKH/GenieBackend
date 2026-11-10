import { Module } from '@nestjs/common';
import {
  HealthController,
  JwtStrategy,
  PrismaModule,
  RedisModule,
} from '@tilomnov/shared';
import { AlertsModule } from './alerts/alerts.module';
import { AdvertisementsModule } from './advertisements/advertisements.module';
import { FeedModule } from './feed/feed.module';
import { PropertiesModule } from './properties/properties.module';
import { SearchModule } from './search/search.module';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';

/**
 * The property service: listings, their photos and engagement, the home
 * screen's search, the feed, and pushes about listings people care about.
 */
@Module({
  imports: [
    AdvertisementsModule,
    SentryErrorsModule,
    RedisModule,
    PrismaModule,
    PropertiesModule,
    SearchModule,
    FeedModule,
    AlertsModule,
  ],
  controllers: [HealthController],
  providers: [JwtStrategy],
})
export class AppModule {}
