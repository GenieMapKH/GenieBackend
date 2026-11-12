import { Injectable, OnModuleInit } from '@nestjs/common';
import { MessageBus, PrismaService } from '@tilomnov/shared';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EmailDeliveryService } from './email-delivery.service';
import {
  SIGN_IN_ALERT_SUBJECT,
  signInAlertEmailHtml,
} from './sign-in-alert-email.template';

export class SignInEmailEvent {
  @IsUUID() userId!: string;
  @IsOptional() @IsString() @MaxLength(100) deviceName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) platform?: string | null;
  @IsOptional() @IsString() @MaxLength(100) ipAddress?: string | null;
  @IsISO8601() signedInAt!: string;
}

@Injectable()
export class SignInEmailConsumer implements OnModuleInit {
  constructor(
    private readonly messages: MessageBus,
    private readonly prisma: PrismaService,
    private readonly mail: EmailDeliveryService,
  ) {}

  onModuleInit(): void {
    this.messages.handleValidated(
      'authentication.sign-in-email.v1',
      SignInEmailEvent,
      async (event) => {
        const user = await this.prisma.user.findUnique({
          where: { id: event.userId },
          select: { email: true },
        });
        if (!user?.email) return;
        const sent = await this.mail.deliver({
          to: user.email,
          subject: SIGN_IN_ALERT_SUBJECT,
          html: signInAlertEmailHtml({
            deviceName: event.deviceName ?? null,
            platform: event.platform ?? null,
            ipAddress: event.ipAddress ?? null,
            signedInAt: new Date(event.signedInAt),
          }),
        });
        if (!sent) throw new Error('Sign-in email was not sent');
      },
    );
  }
}
