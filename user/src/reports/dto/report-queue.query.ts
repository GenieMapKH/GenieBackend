import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { REPORT_STATUSES } from '../report-reasons';

/** `GET /reports/admin`: one page of reports in a status, oldest first. */
export class ReportQueueQuery {
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** The `nextCursor` of the page before. */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
