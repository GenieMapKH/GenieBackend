import { Module } from '@nestjs/common';
import { AdminGuard } from '@tilomnov/shared';
import {
  ReportsAdminController,
  ReportsController,
} from './reports.controller';
import { ReportsService } from './reports.service';

/** Reports of listings and accounts, and the admins' review of them. */
@Module({
  controllers: [ReportsController, ReportsAdminController],
  providers: [ReportsService, AdminGuard],
})
export class ReportsModule {}
