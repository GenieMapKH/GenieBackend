import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, RateLimit, RateLimits } from '@tilomnov/shared';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueueQuery } from './dto/report-queue.query';
import { ReviewReportDto } from './dto/review-report.dto';

/** Enough for anyone reporting honestly; a flood of reports is itself abuse. */
const REPORTS_PER_HOUR = 20;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const FOREIGN_KEY_VIOLATION = 'P2003';

const DEFAULT_PAGE = 50;

/** What the reporter is told: that it was received, nothing about the review. */
export interface ReportReceipt {
  id: string;
  status: string;
  createdAt: Date;
}

const RECEIPT_SELECT = { id: true, status: true, createdAt: true } as const;

/** What an admin reviews. A listing is named by id: the property service owns it. */
const QUEUE_SELECT = {
  id: true,
  propertyId: true,
  reason: true,
  details: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  reviewNote: true,
  reporter: { select: { id: true, name: true, username: true } },
  reportedUser: {
    select: { id: true, name: true, username: true, deactivatedAt: true },
  },
  reviewer: { select: { id: true, name: true, username: true } },
} as const;

type ReportTargetColumn = { propertyId: string } | { reportedUserId: string };

/**
 * Reports of listings and accounts, and their review by admins. A person
 * has one open report per target: reporting again answers the same one.
 */
@Injectable()
export class ReportsService {
  private readonly limiter: RateLimit;

  constructor(
    private readonly prisma: PrismaService,
    rateLimits: RateLimits,
  ) {
    this.limiter = rateLimits.create('reports', REPORTS_PER_HOUR, 60 * 60);
  }

  async create(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<ReportReceipt> {
    if (dto.targetType === 'user' && dto.targetId === reporterId) {
      throw new BadRequestException('You cannot report yourself');
    }
    try {
      await this.limiter.consume(reporterId);
    } catch {
      throw new HttpException(
        'Too many reports. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const target: ReportTargetColumn =
      dto.targetType === 'listing'
        ? { propertyId: dto.targetId }
        : { reportedUserId: dto.targetId };
    try {
      return await this.prisma.report.create({
        data: {
          reporterId,
          ...target,
          reason: dto.reason,
          details: dto.details?.trim() || null,
        },
        select: RECEIPT_SELECT,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === UNIQUE_CONSTRAINT_VIOLATION) {
        return this.openReport(reporterId, target);
      }
      // The database checks the target exists; this service does not read listings.
      if (code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException(
          dto.targetType === 'listing' ? 'Listing not found' : 'User not found',
        );
      }
      throw error;
    }
  }

  /** One page of reports in `status` (open by default), oldest first. */
  async queue(query: ReportQueueQuery) {
    const limit = query.limit ?? DEFAULT_PAGE;
    const rows = await this.prisma.report.findMany({
      where: { status: query.status ?? 'open' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: QUEUE_SELECT,
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? items[items.length - 1].id : null,
    };
  }

  /** Closes an open report. A report already closed is not changed again. */
  async review(adminId: string, reportId: string, dto: ReviewReportDto) {
    const { count } = await this.prisma.report.updateMany({
      where: { id: reportId, status: 'open' },
      data: {
        status: dto.status,
        reviewNote: dto.note?.trim() || null,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: QUEUE_SELECT,
    });
    if (!report) throw new NotFoundException('Report not found');
    if (count === 0) {
      throw new ConflictException(`This report is already ${report.status}`);
    }
    return report;
  }

  private async openReport(
    reporterId: string,
    target: ReportTargetColumn,
  ): Promise<ReportReceipt> {
    const existing = await this.prisma.report.findFirst({
      where: { reporterId, status: 'open', ...target },
      select: RECEIPT_SELECT,
    });
    // Closed between the two reads: there is no open one to answer.
    if (!existing) throw new ConflictException('Try reporting again');
    return existing;
  }
}
