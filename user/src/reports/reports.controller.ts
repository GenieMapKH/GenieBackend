import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard, CurrentUserId } from '@tilomnov/shared';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueueQuery } from './dto/report-queue.query';
import { ReviewReportDto } from './dto/review-report.dto';
import { ReportsService } from './reports.service';

/** Reporting a listing or an account. */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Report a listing or an account (the same open report again changes nothing)',
  })
  @ApiResponse({ status: 400, description: 'Invalid report, or yourself' })
  @ApiResponse({ status: 404, description: 'Listing or user not found' })
  @ApiResponse({ status: 429, description: 'Too many reports' })
  create(@CurrentUserId() reporterId: string, @Body() dto: CreateReportDto) {
    return this.reports.create(reporterId, dto);
  }
}

/** The review queue. Admins only; there is no admin screen yet. */
@ApiTags('reports')
@UseGuards(AdminGuard)
@Controller('reports/admin')
export class ReportsAdminController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Reports in a status (open by default), oldest first',
  })
  queue(@Query() query: ReportQueueQuery) {
    return this.reports.queue(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Resolve or dismiss an open report' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @ApiResponse({ status: 409, description: 'Already resolved or dismissed' })
  review(
    @CurrentUserId() adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.reports.review(adminId, id, dto);
  }
}
