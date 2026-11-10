import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { AuthAttemptLimits } from '../attempt-limiter';
import { BCRYPT_ROUNDS, OTP_TTL_MINUTES } from '../auth.constants';
import { EmailDeliveryService } from '../mail/email-delivery.service';
import { otpEmailHtml, otpEmailSubject } from '../mail/otp-email.template';
import { TokenSigner } from '../signing-keys/token-signer.service';

const PROOF_TYPE = 'email-verification';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: AuthAttemptLimits,
    private readonly mail: EmailDeliveryService,
    private readonly signer: TokenSigner,
  ) {}

  async request(email: string, clientIp: string | null): Promise<void> {
    if (clientIp)
      await this.limits.resetRequestsPerClient.consumeOrReject(
        clientIp,
        'in an hour',
      );
    const key = `verify:${email}`;
    await this.limits.resetCooldown.consumeOrReject(key, 'in a minute');
    await this.limits.resetRequestsPerDay.consumeOrReject(key, 'tomorrow');
    const code = randomInt(100000, 1000000).toString();
    const data = {
      codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    };
    await this.prisma.emailVerification.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    await this.prisma.emailVerification.upsert({
      where: { email },
      create: { email, ...data },
      update: data,
    });
    const sent = await this.mail.deliver({
      to: email,
      subject: otpEmailSubject(code),
      html: otpEmailHtml(code, 'verification'),
    });
    if (!sent)
      throw new ServiceUnavailableException(
        'We could not send your verification code. Please try again.',
      );
  }

  async confirm(email: string, code: string) {
    await this.limits.otp.consumeOrReject(`verify:${email}`);
    await this.limits.otpPerDay.consumeOrReject(`verify:${email}`, 'tomorrow');
    const row = await this.prisma.emailVerification.findUnique({
      where: { email },
    });
    if (
      !row ||
      row.expiresAt <= new Date() ||
      !(await bcrypt.compare(code, row.codeHash))
    )
      throw new BadRequestException('Invalid or expired verification code');
    const claimed = await this.prisma.emailVerification.deleteMany({
      where: { email, codeHash: row.codeHash, expiresAt: { gt: new Date() } },
    });
    if (claimed.count !== 1)
      throw new BadRequestException('Invalid or expired verification code');
    return {
      proofToken: this.signer.sign({ sub: email, typ: PROOF_TYPE }, 300),
    };
  }

  requireProof(email: string, proof: string | undefined): void {
    try {
      if (!proof) throw new Error('Missing proof');
      const payload = this.signer.verifyRefreshToken<{
        sub: string;
        typ: string;
      }>(proof);
      if (payload.typ !== PROOF_TYPE || payload.sub !== email)
        throw new Error('Wrong proof');
    } catch {
      throw new BadRequestException(
        'Verify this email address with a new code before continuing.',
      );
    }
  }
}
