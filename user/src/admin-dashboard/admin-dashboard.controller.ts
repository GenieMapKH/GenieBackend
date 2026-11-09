import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '@tilomnov/shared';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminRecordsService } from './admin-records.service';
import { AdminRecordsQuery } from './admin-records.query';
import { AdminSystemHealthService } from './admin-system-health.service';

@UseGuards(AdminGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly records: AdminRecordsService,
    private readonly health: AdminSystemHealthService,
  ) {}

  @Get()
  overview() {
    return this.dashboard.overview();
  }

  @Get('records')
  list(@Query() query: AdminRecordsQuery) {
    return this.records.list(query);
  }

  @Get('health')
  systemHealth() {
    return this.health.check();
  }
}
