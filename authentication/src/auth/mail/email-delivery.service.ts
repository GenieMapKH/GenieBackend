import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

const SMTP_TIMEOUTS = {
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 12000,
};
const SMTP_FALLBACK_PORT = 2525;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends one email. Providers are tried in order until one succeeds:
 * Brevo (HTTPS) -> Resend (HTTPS) -> SMTP.
 * HTTPS providers come first because hosts such as Railway block SMTP ports.
 */
@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  /** False when no provider took the message. Failures are logged, never thrown. */
  async deliver(message: EmailMessage): Promise<boolean> {
    try {
      return (
        (await this.sendWithBrevo(message)) ||
        (await this.sendWithResend(message)) ||
        (await this.sendWithSmtp(message))
      );
    } catch (error) {
      this.logger.error(`Failed to send email: ${(error as Error).message}`);
      return false;
    }
  }

  private get sender(): string | undefined {
    return process.env.SMTP_FROM || process.env.SMTP_USER;
  }

  private async sendWithBrevo(message: EmailMessage): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return false;

    return this.postJson(
      'Brevo',
      'https://api.brevo.com/v3/smtp/email',
      {
        'api-key': apiKey,
        accept: 'application/json',
      },
      {
        sender: { name: 'Tilomnov Support', email: this.sender },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
      },
    );
  }

  private async sendWithResend(message: EmailMessage): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return false;

    return this.postJson(
      'Resend',
      'https://api.resend.com/emails',
      {
        Authorization: `Bearer ${apiKey}`,
      },
      {
        from: `Tilomnov Support <${this.sender}>`,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      },
    );
  }

  private async sendWithSmtp(message: EmailMessage): Promise<boolean> {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return false;

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const configuredPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const primaryPort = configuredPort === 587 ? 465 : configuredPort;
    const mail = { from: `"Tilomnov Support" <${this.sender}>`, ...message };

    try {
      await this.smtpTransport(
        host,
        primaryPort,
        primaryPort === 465,
        user,
        pass,
      ).sendMail(mail);
      return true;
    } catch (error) {
      this.logger.warn(
        `SMTP port ${primaryPort} failed (${(error as Error).message}); retrying on ${SMTP_FALLBACK_PORT}`,
      );
      await this.smtpTransport(
        host,
        SMTP_FALLBACK_PORT,
        false,
        user,
        pass,
      ).sendMail(mail);
      return true;
    }
  }

  private smtpTransport(
    host: string,
    port: number,
    secure: boolean,
    user: string,
    pass: string,
  ) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      ...SMTP_TIMEOUTS,
    });
  }

  private async postJson(
    provider: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      if (response.ok) return true;
      // The provider's own reason (bad key, unauthorised IP, unverified sender) is what tells an operator what to fix.
      const reason = (await response.text().catch(() => ''))
        .replace(/\s+/g, ' ')
        .slice(0, 200);
      this.logger.warn(
        `${provider} responded with status ${response.status}${reason ? `: ${reason}` : ''}`,
      );
    } catch (error) {
      this.logger.warn(
        `${provider} request failed: ${(error as Error).message}`,
      );
    }
    return false;
  }
}
