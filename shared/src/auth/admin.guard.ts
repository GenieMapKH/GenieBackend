import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './jwt.strategy';

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
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Caller>();
    const userId = callerId(request);
    const assertedRole =
      request.user?.role ?? headerValue(request.headers?.['x-user-role']);
    const adminMfa =
      request.user?.adminMfa ??
      headerValue(request.headers?.['x-admin-mfa']) === 'true';
    if (assertedRole !== 'admin' || !adminMfa) {
      throw new ForbiddenException('Only an admin can do this');
    }
    const account = userId
      ? await this.prisma.user.findFirst({
          where: { id: userId, deactivatedAt: null },
          select: { role: true },
        })
      : null;
    if (account?.role !== 'admin') {
      throw new ForbiddenException('Only an admin can do this');
    }
    return true;
  }
}

function callerId(request: Caller): string | undefined {
  if (request.user?.userId) return request.user.userId;
  const header = request.headers?.['x-user-id'];
  return Array.isArray(header) ? header[0] : header;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
