import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const LIMITS = {
  avatar: { bytes: 2 * 1024 * 1024, count: 20 },
  attachment: { bytes: 12 * 1024 * 1024, count: 100 },
  property: { bytes: 8 * 1024 * 1024, count: 120 },
} as const;

/** Charges the bucket's maximum bytes, not an untrusted client size declaration. */
@Injectable()
export class UploadBudgets {
  constructor(private readonly prisma: PrismaService) {}

  async take(
    userId: string,
    kind: keyof typeof LIMITS,
    count = 1,
  ): Promise<void> {
    const limit = LIMITS[kind];
    if (!Number.isInteger(count) || count < 1 || count > limit.count)
      throw new HttpException('Upload budget exceeded', 429);
    const bytes = count * limit.bytes;
    const rows = await this.prisma.$queryRaw<{ issued_count: number }[]>`
      INSERT INTO account.upload_budgets (user_id, kind, day, issued_bytes, issued_count)
      VALUES (${userId}::uuid, ${kind}, (now() AT TIME ZONE 'UTC')::date, ${bytes}, ${count})
      ON CONFLICT (user_id, kind, day) DO UPDATE
      SET issued_bytes = upload_budgets.issued_bytes + EXCLUDED.issued_bytes,
          issued_count = upload_budgets.issued_count + EXCLUDED.issued_count
      WHERE upload_budgets.issued_count + EXCLUDED.issued_count <= ${limit.count}
        AND upload_budgets.issued_bytes + EXCLUDED.issued_bytes <= ${limit.count * limit.bytes}
      RETURNING issued_count`;
    if (rows.length !== 1)
      throw new HttpException('Daily upload budget exceeded', 429);
  }
}
