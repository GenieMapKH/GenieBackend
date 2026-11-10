import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  REPORT_REASONS,
  REPORT_TARGETS,
  type ReportReason,
  type ReportTarget,
} from '../report-reasons';

/** Room for a few sentences: what an admin needs, not a conversation. */
export const MAX_DETAILS_LENGTH = 1000;

/** `POST /reports`: something a user thinks an admin should look at. */
export class CreateReportDto {
  @IsIn(REPORT_TARGETS)
  targetType: ReportTarget;

  @IsUUID()
  targetId: string;

  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DETAILS_LENGTH)
  details?: string;
}
