import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { MessageBus } from '@tilomnov/shared';
import { AccountService } from '../account/account.service';
import { EmailDeliveryService } from '../mail/email-delivery.service';
import {
  SIGN_IN_ALERT_SUBJECT,
  signInAlertEmailHtml,
} from '../mail/sign-in-alert-email.template';
import { NotificationClient } from '../notifications/notification.client';
import { UserRecord } from '../users/user.repository';
import { ClientContext } from './client-context';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenIssuerService, TokenPair } from './token-issuer.service';

/**
 * What every successful sign-in ends with, whichever way the user proved who
 * they are (password or Google): the account comes back if it was
 * deactivated, a new session starts, and the owner is told when the account
 * was already in use on another device.
 */
@Injectable()
export class SignInService {
  private readonly logger = new Logger(SignInService.name);

  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(TokenIssuerService) private readonly tokens: TokenIssuerService,
    @Inject(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(EmailDeliveryService) private readonly mail: EmailDeliveryService,
    @Inject(NotificationClient)
    private readonly notifications: NotificationClient,
    @Optional() private readonly messages?: MessageBus,
  ) {}

  async complete(
    user: UserRecord,
    client: ClientContext,
    { adminEmailVerified = false }: { adminEmailVerified?: boolean } = {},
  ): Promise<TokenPair> {
    if (user.role === 'admin' && !adminEmailVerified) {
      throw new UnauthorizedException(
        'Administrator email verification required',
      );
    }
    await this.account.reactivate(user);

    const alreadySignedInElsewhere =
      (await this.refreshTokens.listSessionTokens(user.id)).length > 0;
    const { sessionId, ...tokens } = await this.refreshTokens.withUserLock(
      user.id,
      async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: user.id },
          select: {
            role: true,
            passwordHash: true,
            bannedAt: true,
            deactivatedAt: true,
          },
        });
        if (
          !current ||
          current.bannedAt ||
          current.deactivatedAt ||
          current.role !== user.role ||
          current.passwordHash !== user.password_hash
        )
          throw new UnauthorizedException(
            'Account changed. Please sign in again.',
          );
        return this.tokens.issue(
          user.id,
          current.role,
          client,
          undefined,
          adminEmailVerified,
          tx,
        );
      },
    );
    if (alreadySignedInElsewhere)
      await this.alertOwner(user, client, sessionId);
    return tokens;
  }

  /**
   * By push to the account's other devices, and by email, because it reaches
   * the owner wherever they are. Signing in waits for neither, and never
   * fails because of them.
   */
  private async alertOwner(
    user: UserRecord,
    client: ClientContext,
    sessionId: string,
  ): Promise<void> {
    await this.notifications.signIn({
      userId: user.id,
      sessionId,
      deviceName: client.deviceName,
      platform: client.platform,
    });
    if (!user.email) return;

    if (this.messages?.enabled) {
      try {
        await this.messages.enqueue(
          'authentication.sign-in-email.v1',
          {
            userId: user.id,
            ...client,
            signedInAt: new Date().toISOString(),
          },
          { key: `sign-in-email:${sessionId}` },
        );
      } catch {
        this.logger.error('Sign-in email could not be recorded');
      }
      return;
    }

    this.mail
      .deliver({
        to: user.email,
        subject: SIGN_IN_ALERT_SUBJECT,
        html: signInAlertEmailHtml({ ...client, signedInAt: new Date() }),
      })
      .catch((error: Error) =>
        this.logger.warn(`Sign-in alert not sent: ${error.message}`),
      );
  }
}
