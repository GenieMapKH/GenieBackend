import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { RedisConnection } from '../redis/redis-connection';
import { AuthAttemptLimits } from './attempt-limiter';
import { EmailDeliveryService } from './mail/email-delivery.service';
import { ClientContext } from './sessions/client-context';
import { SignInService } from './sessions/sign-in.service';
import { UserRecord, UserRepository } from './users/user.repository';

export interface AdminLoginPending {
  status: 'admin_email_required';
}

const LINK_URL = 'https://tilomnovgateway.sparkbytekh.com/admin-login';

@Injectable()
export class AdminLoginService {
  constructor(
    private readonly users: UserRepository,
    private readonly signIn: SignInService,
    private readonly mail: EmailDeliveryService,
    private readonly limits: AuthAttemptLimits,
    private readonly redis: RedisConnection,
  ) {}

  /** Called only after the account's password has been checked. */
  async start(user: UserRecord): Promise<AdminLoginPending> {
    if (
      user.role !== 'admin' ||
      !user.email ||
      !user.email_verified ||
      user.deactivated_at
    )
      throw new UnauthorizedException('Invalid credentials');
    await this.limits.resetCooldown.consumeOrReject(
      `admin-login:${user.id}`,
      'in a minute',
    );
    const token = randomBytes(32).toString('base64url');
    const key = this.challengeKey(token);
    // Bind the challenge to the identity and password that were verified.
    const stored = await this.redis.client.set(
      key,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        passwordHash: user.password_hash,
      }),
      'EX',
      600,
      'NX',
    );
    if (stored !== 'OK') throw new ServiceUnavailableException();
    const link = `${LINK_URL}?token=${token}`;
    const delivered = await this.mail.deliver({
      to: user.email,
      subject: 'Finish your Tilomnov admin sign-in',
      html: `<p>Your password was accepted. Tap the button to finish signing in.</p><p><a href="${link}" style="display:inline-block;padding:14px 24px;background:#ad792b;color:white;border-radius:8px;text-decoration:none">Open Tilomnov</a></p><p>This link expires in 10 minutes and works only once. If you did not request it, do not open it and change your password.</p>`,
    });
    if (!delivered) {
      await this.redis.client.del(key);
      throw new ServiceUnavailableException(
        'Admin sign-in email could not be delivered. Please try again.',
      );
    }
    return { status: 'admin_email_required' };
  }

  async complete(token: string, client: ClientContext) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Invalid or expired sign-in link');
    // Atomic consumption prevents concurrent requests from reusing the link.
    const stored = await this.redis.client.getdel(this.challengeKey(token));
    if (!stored)
      throw new UnauthorizedException('Invalid or expired sign-in link');
    const proof = JSON.parse(stored) as {
      userId: string;
      email: string;
      passwordHash: string;
    };
    const user = await this.users.findById(proof.userId);
    if (
      !user ||
      user.role !== 'admin' ||
      !user.email_verified ||
      user.deactivated_at ||
      user.email !== proof.email ||
      user.password_hash !== proof.passwordHash
    )
      throw new UnauthorizedException('Invalid or expired sign-in link');
    return this.signIn.complete(user, client, { adminEmailVerified: true });
  }

  private challengeKey(token: string): string {
    return `admin-login:${createHash('sha256').update(token).digest('hex')}`;
  }
}
