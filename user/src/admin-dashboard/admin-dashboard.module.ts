import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemHealthService } from './admin-system-health.service';
import { AdminGuard } from '@tilomnov/shared';

@Module({
  controllers: [AdminDashboardController],
  providers: [
    AdminDashboardService,
    AdminRecordsService,
    AdminSystemHealthService,
    AdminGuard,
  ],
})
export class AdminDashboardModule {}
