import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { databaseCall } from '../database-call';

export interface PasswordResetOtpRecord {
  id: string;
  otp_hash: string;
}

/** All reads and writes of the `password_reset_otps` table. */
@Injectable()
export class PasswordResetOtpRepository {
  private readonly logger = new Logger(PasswordResetOtpRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Marks every unused code for the email as used, so only the newest one works. */
  async invalidateAllFor(email: string): Promise<void> {
    await databaseCall(this.logger, 'Failed to initiate password reset', () =>
      this.prisma.password_reset_otps.updateMany({
        where: { email, used: false },
        data: { used: true },
      }),
    );
  }

  async create(email: string, otpHash: string, expiresAt: Date): Promise<void> {
    await databaseCall(this.logger, 'Failed to initiate password reset', () =>
      this.prisma.password_reset_otps.create({
        data: { email, otp_hash: otpHash, expires_at: expiresAt, used: false },
        select: { id: true },
      }),
    );
  }

  findLatestActive(email: string): Promise<PasswordResetOtpRecord | null> {
    return databaseCall(this.logger, 'Failed to verify code', () =>
      this.prisma.password_reset_otps.findFirst({
        where: { email, used: false, expires_at: { gte: new Date() } },
        orderBy: { created_at: 'desc' },
        select: { id: true, otp_hash: true },
      }),
    );
  }

  /** Removes every code ever sent to the email: nothing of a deleted account is kept. */
  async deleteAllFor(email: string): Promise<void> {
    await databaseCall(this.logger, 'Failed to delete account', () =>
      this.prisma.password_reset_otps.deleteMany({ where: { email } }),
    );
  }

  /**
   * Marks the code used, in one step that only succeeds while it is still
   * unused. False when another request used it first: two resets sent at
   * once with the same code must not both go through.
   */
  async claim(id: string): Promise<boolean> {
    const { count } = await databaseCall(
      this.logger,
      'Failed to verify code',
      () =>
        this.prisma.password_reset_otps.updateMany({
          where: { id, used: false },
          data: { used: true },
        }),
    );
    return count > 0;
  }
}
