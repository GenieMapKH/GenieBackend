import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ACCESS_TOKEN, verifySignedToken } from './signed-token';
import { KeySetUnavailableError } from './auth-key-set';

/**
 * Injects the authenticated user's id.
 *
 * Verifies the bearer and durable session even when the gateway is bypassed.
 * Client-supplied identity headers are never authentication.
 */
export const CurrentUserId = createParamDecorator(
  async (_data: unknown, context: ExecutionContext): Promise<string> => {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string'
        ? header.match(/^Bearer +(\S+)$/i)?.[1]
        : undefined;
    if (!token) {
      throw new UnauthorizedException('User not authenticated');
    }
    const claims = await verifySignedToken(token, ACCESS_TOKEN).catch(
      (error: unknown) => {
        if (error instanceof ServiceUnavailableException) throw error;
        if (error instanceof KeySetUnavailableError)
          throw new ServiceUnavailableException('Could not verify sign-in');
        throw new UnauthorizedException('Invalid or expired token');
      },
    );
    if (claims.role === 'admin' && claims.adminMfa !== true)
      throw new UnauthorizedException(
        'Administrator email verification required',
      );
    return claims.sub;
  },
);
