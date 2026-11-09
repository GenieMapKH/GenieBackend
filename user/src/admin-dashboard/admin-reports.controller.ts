import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '@tilomnov/shared';
import { AdminReportsService } from './admin-reports.service';
import { AdminPageQuery } from './admin-moderation.dto';

@UseGuards(AdminGuard)
@Controller('admin/moderation/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}
  @Get()
  groups(@Query() query: AdminPageQuery) {
    return this.reports.groups(query);
  }
  @Get(':type/:id')
  detail(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminPageQuery,
  ) {
    return this.reports.detail(type, id, query);
  }
}
