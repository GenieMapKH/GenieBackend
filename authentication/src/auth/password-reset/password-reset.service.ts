import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { BCRYPT_ROUNDS, OTP_TTL_MINUTES } from '../auth.constants';
import { OtpEmailService } from '../mail/otp-email.service';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';
import {
  PasswordResetOtpRepository,
  PasswordResetOtpRecord,
} from './password-reset-otp.repository';

const REQUEST_ACCEPTED =
  'If the email exists, a verification code has been sent.';

/** Forgot-password flow: request a code, verify it, set a new password. */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(PasswordResetOtpRepository)
    private readonly otps: PasswordResetOtpRepository,
    @Inject(SessionRevocationService)
    private readonly sessions: SessionRevocationService,
    @Inject(OtpEmailService) private readonly mailer: OtpEmailService,
  ) {}

  /**
   * Answers at once, the same way and after the same work whether or not the
   * account exists, so the reply (or how long it takes) never tells. The
   * code is stored and emailed afterwards.
   */
  async requestReset(email: string): Promise<{ message: string }> {
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
    const user = await this.users.findByEmail(email);

    if (user?.email_verified) {
      this.issueCode(email, otp, otpHash).catch((err: Error | undefined) => {
        this.logger.error(`Failed to issue OTP: ${err?.message}`);
      });
    }
    return { message: REQUEST_ACCEPTED };
  }

  /** Replaces any earlier code for the email with this one, then emails it. */
  private async issueCode(
    email: string,
    otp: string,
    otpHash: string,
  ): Promise<void> {
    await this.otps.invalidateAllFor(email);
    await this.otps.create(email, otpHash, this.otpExpiry());
    await this.mailer.sendOtp(email, otp);
  }

  async verifyOtp(
    email: string,
    otp: string,
  ): Promise<{ message: string; verified: boolean }> {
    await this.findMatchingOtp(email, otp);
    return { message: 'OTP verified successfully', verified: true };
  }

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const record = await this.findMatchingOtp(email, otp);
    const user = await this.users.findByEmail(email);
    // Used up before the password changes: of two resets sent at once with
    // the same code, only the first one gets here.
    if (!user?.email_verified || !(await this.otps.claim(record.id))) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.users.update(user.id, {
      password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      has_password: true,
    });

    // Force every device to log in again with the new password.
    await this.sessions.endAllSessions(user.id);

    return { message: 'Password reset successfully' };
  }

  /** Returns the newest active code for the email if `otp` matches it. */
  private async findMatchingOtp(
    email: string,
    otp: string,
  ): Promise<PasswordResetOtpRecord> {
    const record = await this.otps.findLatestActive(email);
    if (!record) {
      throw new BadRequestException('Invalid or expired verification code');
    }
    if (!(await bcrypt.compare(otp, record.otp_hash))) {
      throw new BadRequestException('Invalid verification code');
    }
    return record;
  }

  /** Cryptographically secure 6-digit code. */
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  private otpExpiry(): Date {
    return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  }
}
