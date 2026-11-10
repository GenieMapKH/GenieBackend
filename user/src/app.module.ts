import { Module } from '@nestjs/common';
import { HealthController, PrismaModule, RedisModule } from '@tilomnov/shared';
import { BlocksModule } from './blocks/blocks.module';
import { FollowsModule } from './follows/follows.module';
import { ReportsModule } from './reports/reports.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { UsersModule } from './users/users.module';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';

/**
 * The user service: profiles, following, blocking, reports, and what happens
 * to an account's content.
 */
@Module({
  imports: [
    SentryErrorsModule,
    RedisModule,
    PrismaModule,
    UsersModule,
    FollowsModule,
    BlocksModule,
    ReportsModule,
    AdminDashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
