import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminSystemHealthService } from './admin-system-health.service';
import { AdminRotationService } from './admin-rotation.service';
import { AdminRotationJobService } from './admin-rotation-job.service';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminSentryService } from './admin-sentry.service';
import { AdminDeploymentsService } from './admin-deployments.service';
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
    AdminOperationsController,
    AdminAdvertisementsController,
    AdminDashboardController,
    AdminPropertiesController,
    AdminAccountActionsController,
    AdminReportsController,
  ],
  providers: [
    AdminRotationJobService,
    AdminSentryService,
    AdminDeploymentsService,
    AdminPlatformService,
    AdminReportsService,
    AdminDashboardService,
    AdminRecordsService,
    AdminSystemHealthService,
    AdminRotationService,
    AdminGuard,
  ],
})
export class AdminDashboardModule {}
