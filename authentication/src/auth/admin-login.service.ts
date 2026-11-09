import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthAttemptLimits } from './attempt-limiter';
import { EmailDeliveryService } from './mail/email-delivery.service';
import { UserRepository } from './users/user.repository';
import { ClientContext } from './sessions/client-context';
import { SignInService } from './sessions/sign-in.service';
import { RedisConnection } from '../redis/redis-connection';

const CHALLENGE_TTL_SECONDS = 10 * 60;
const CHALLENGE_PREFIX = 'admin-login:';

@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly signIn: SignInService,
    private readonly mail: EmailDeliveryService,
    private readonly limits: AuthAttemptLimits,
    private readonly redis: RedisConnection,
  ) {}

  async start(
    emailInput: string,
    password: string,
    client: ClientContext,
  ): Promise<{ message: string }> {
    const email = emailInput.trim().toLowerCase();
    await this.limits.loginPerSource.consumeOrReject(
      `${email}|admin:${client.ipAddress ?? 'unknown'}`,
    );
    await this.limits.loginPerNetwork.consumeOrReject(
      client.ipAddress ?? 'unknown',
      'in an hour',
    );

    const configuredEmail = process.env.ADMIN_LOGIN_EMAIL?.trim().toLowerCase();
    const user =
      configuredEmail === email ? await this.users.findByEmail(email) : null;
    const matches = user?.has_password
      ? await bcrypt.compare(password, user.password_hash)
      : false;
    if (!matches || !user || user.role !== 'admin' || user.deactivated_at) {
      // Compare a dummy hash too when the email is not an admin to reduce timing leaks.
      if (!user?.has_password)
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid admin credentials');
    }
    await this.limits.loginPerSource.reset(
      `${email}|admin:${client.ipAddress ?? 'unknown'}`,
    );

    const token = randomBytes(32).toString('base64url');
    const stored = await this.redis.client.set(
      this.challengeKey(token),
      user.id,
      'EX',
      CHALLENGE_TTL_SECONDS,
      'NX',
    );
    if (stored !== 'OK') throw new ServiceUnavailableException();

    const linkBase = process.env.ADMIN_APP_LINK_URL;
    if (!linkBase) {
      await this.redis.client.del(this.challengeKey(token));
      throw new ServiceUnavailableException(
        'Admin sign-in link is not configured',
      );
    }
    const link = new URL(linkBase);
    if (link.protocol !== 'https:') {
      await this.redis.client.del(this.challengeKey(token));
      throw new ServiceUnavailableException(
        'Admin sign-in link must use HTTPS',
      );
    }
    link.searchParams.set('token', token);
    const delivered = await this.mail.deliver({
      to: email,
      subject: 'Your Tilomnov admin sign-in link',
      html: `<p>Tap to finish signing in to the Tilomnov admin dashboard.</p><p><a href="${link.toString()}">Open Tilomnov</a></p><p>This link expires in 10 minutes and can only be used once.</p>`,
    });
    if (!delivered) {
      await this.redis.client.del(this.challengeKey(token));
      this.logger.error('Admin sign-in email could not be delivered');
      throw new ServiceUnavailableException(
        'Admin sign-in email could not be delivered',
      );
    }
    return {
      message: 'If the credentials are valid, a sign-in link has been sent.',
    };
  }

  async complete(token: string, client: ClientContext) {
    const userId = await this.redis.client.getdel(this.challengeKey(token));
    if (!userId)
      throw new UnauthorizedException('Invalid or expired sign-in link');

    const user = await this.users.findById(userId);
    const configuredEmail = process.env.ADMIN_LOGIN_EMAIL?.trim().toLowerCase();
    if (
      !user ||
      user.role !== 'admin' ||
      user.deactivated_at ||
      user.email?.toLowerCase() !== configuredEmail
    ) {
      throw new UnauthorizedException('Invalid or expired sign-in link');
    }
    return this.signIn.complete(user, client, { adminEmailVerified: true });
  }

  private challengeKey(token: string): string {
    const digest = createHash('sha256').update(token).digest('hex');
    return `${CHALLENGE_PREFIX}${digest}`;
  }
}

const DUMMY_PASSWORD_HASH =
  '$2b$10$YxXh7uKzVxMlfvQ0aRUwueJLGmE/6cH2GjyfUVUY1dGLwJ9IYjD.i';
