import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService, serviceCallGuard } from '@tilomnov/shared';
import { AdminListingRecordsService } from '../services/admin-listing-records.service';

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/dashboard', version: VERSION_NEUTRAL })
export class InternalAdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: AdminListingRecordsService,
  ) {}

  @Get('records')
  list(
    @Query('section') section: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('q') q?: string,
  ) {
    return this.records.list(section, offset, q);
  }

  @Get()
  async overview() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, active, newLast7Days, leadsLast7Days] = await Promise.all([
      this.prisma.property.count(),
      this.prisma.property.count({ where: { status: 'Active' } }),
      this.prisma.property.count({ where: { createdAt: { gte: since } } }),
      this.prisma.propertyLead.count({ where: { createdAt: { gte: since } } }),
    ]);
    return { total, active, newLast7Days, leadsLast7Days };
  }
}
