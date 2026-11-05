import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  INTERNAL_TOKEN,
  KeySetUnavailableError,
  verifySignedToken,
} from '@tilomnov/shared';

/**
 * Lets in only the authentication service, and only for the account named in
 * the route (`:userId`). `/internal` routes are not forwarded by the gateway;
 * the one-minute token it signs is what stops anyone else who can reach this
 * service from calling them.
 */
@Injectable()
export class InternalCallGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      params: { userId?: string };
    }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : null;

    try {
      if (
        token &&
        (await verifySignedToken(token, INTERNAL_TOKEN)).sub ===
          request.params.userId
      )
        return true;
    } catch (error) {
      if (error instanceof KeySetUnavailableError) {
        throw new ServiceUnavailableException();
      }
      // Falls through to the refusal below.
    }
    throw new UnauthorizedException();
  }
}
