import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryService } from './email-delivery.service';
import { otpEmailHtml, otpEmailSubject } from './otp-email.template';

/**
 * Delivers the password-reset code. A failure is logged, never thrown: the
 * code is stored and can be requested again.
 */
@Injectable()
export class OtpEmailService {
  private readonly logger = new Logger(OtpEmailService.name);

  constructor(
    @Inject(EmailDeliveryService)
    private readonly delivery: EmailDeliveryService,
  ) {}

  async sendOtp(to: string, otp: string): Promise<void> {
    const sent = await this.delivery.deliver({
      to,
      subject: otpEmailSubject(otp),
      html: otpEmailHtml(otp),
    });
    if (sent) return;

    this.logger.warn(
      'The reset code was not sent: no email provider is configured, or all of them failed.',
    );
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV] OTP for ${to}: ${otp}`);
    }
  }
}
