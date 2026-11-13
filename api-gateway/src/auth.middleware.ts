import {
  Injectable,
  Logger,
  NestMiddleware,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ACCESS_TOKEN,
  KeySetUnavailableError,
  verifySignedToken,
} from '@tilomnov/shared';
import { NextFunction, Request, Response } from 'express';
import { RevokedSessions } from './revoked-sessions';

/**
 * Verifies the access token and writes the caller's id to `x-user-id`
 * for the downstream services. Anything the client sent in that header is
 * overwritten. A refresh token is refused: it is signed with the same keys but
 * lives 30 days. So is the token of a device that was signed out, even though
 * it has not expired yet. The keys come from the authentication service (JWKS).
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly revokedSessions: RevokedSessions) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    if (req.method === 'OPTIONS') {
      return next();
    }

    const token = this.readBearerToken(req);
    if (!token) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const { userId, sessionId, role, adminMfa } = await this.verify(token);
    if (role === 'admin' && !adminMfa) {
      throw new UnauthorizedException(
        'Administrator email verification required',
      );
    }
    if (sessionId && (await this.revokedSessions.has(sessionId))) {
      throw new UnauthorizedException('This device was signed out');
    }

    req.headers['x-user-id'] = userId;
    req.headers['x-user-role'] = role;
    req.headers['x-admin-mfa'] = adminMfa ? 'true' : 'false';
    next();
  }

  /** `sessionId` is missing from tokens issued before sessions existed. */
  private async verify(token: string): Promise<{
    userId: string;
    sessionId?: string;
    role: string;
    adminMfa: boolean;
  }> {
    try {
      const payload = await verifySignedToken(token, ACCESS_TOKEN);
      return {
        userId: payload.sub,
        sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
        // Missing roles on legacy tokens are regular-user sessions.
        role: typeof payload.role === 'string' ? payload.role : 'user',
        adminMfa: payload.adminMfa === true,
      };
    } catch (error) {
      // Our outage, not a bad token: a 401 would make the app sign out.
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof KeySetUnavailableError) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException('Please try again in a moment');
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** The scheme name is case-insensitive (RFC 7235), so `bearer` works like `Bearer`. */
  private readBearerToken(req: Request): string | null {
    const header = req.headers['authorization'];
    return header?.match(/^Bearer +(\S+)$/i)?.[1] ?? null;
  }
}
