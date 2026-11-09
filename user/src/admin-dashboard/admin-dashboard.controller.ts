import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '@tilomnov/shared';
import { AdminDashboardService } from './admin-dashboard.service';

@UseGuards(AdminGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  overview() {
    return this.dashboard.overview();
  }
}
