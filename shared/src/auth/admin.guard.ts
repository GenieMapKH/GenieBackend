import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './jwt.strategy';
import { RedisConnection } from '../redis/redis-connection';
import { ACCESS_TOKEN, verifySignedToken } from './signed-token';
import { KeySetUnavailableError } from './auth-key-set';

type Caller = {
  user?: AuthenticatedUser;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Lets in admins only. The signed token role prevents an old user session
 * from gaining admin access after promotion; the database role revokes access
 * immediately when an admin is demoted.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisConnection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Caller>();
    const token = headerValue(request.headers?.authorization)?.match(
      /^Bearer +(\S+)$/i,
    )?.[1];
    if (!token)
      throw new UnauthorizedException('Administrator sign-in required');
    const claims = await verifySignedToken(token, ACCESS_TOKEN).catch(
      (error: unknown) => {
        if (error instanceof KeySetUnavailableError)
          throw new ServiceUnavailableException('Please try again in a moment');
        throw new UnauthorizedException('Invalid or expired token');
      },
    );
    const userId = claims.sub;
    if (claims.role !== 'admin' || claims.adminMfa !== true) {
      throw new ForbiddenException('Only an admin can do this');
    }
    if (typeof claims.sid !== 'string' || !claims.sid)
      throw new UnauthorizedException('Administrator sign-in required');
    // Admin access fails closed when session revocation cannot be checked.
    const revoked = await this.redis.client
      .exists(`sessions:revoked:${claims.sid}`)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Could not verify administrator session',
        );
      });
    if (revoked) throw new UnauthorizedException('This device was signed out');
    const account = userId
      ? await this.prisma.user.findFirst({
          where: { id: userId, deactivatedAt: null },
          select: { role: true },
        })
      : null;
    if (account?.role !== 'admin') {
      throw new ForbiddenException('Only an admin can do this');
    }
    request.user = {
      userId,
      role: 'admin',
      adminMfa: true,
      sessionId: claims.sid,
    };
    request.headers['x-user-id'] = userId;
    request.headers['x-user-role'] = 'admin';
    request.headers['x-admin-mfa'] = 'true';
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
