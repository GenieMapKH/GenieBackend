import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REVIEW_OUTCOMES } from '../report-reasons';

/** `PATCH /reports/admin/:id`: an admin closes a report. */
export class ReviewReportDto {
  @IsIn(REVIEW_OUTCOMES)
  status: (typeof REVIEW_OUTCOMES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
