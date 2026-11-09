import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemHealthService } from './admin-system-health.service';
import { AdminGuard } from '@tilomnov/shared';
import {
  AdminPropertiesController,
  AdminAccountActionsController,
} from './admin-properties.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminPlatformService } from './admin-platform.service';
import { AdminAdvertisementsController } from './admin-advertisements.controller';

@Module({
  controllers: [
    AdminAdvertisementsController,
    AdminDashboardController,
    AdminPropertiesController,
    AdminAccountActionsController,
    AdminReportsController,
  ],
  providers: [
    AdminPlatformService,
    AdminReportsService,
    AdminDashboardService,
    AdminRecordsService,
    AdminSystemHealthService,
    AdminGuard,
  ],
})
export class AdminDashboardModule {}
