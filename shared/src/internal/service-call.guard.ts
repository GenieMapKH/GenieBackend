import {
  CanActivate,
  ExecutionContext,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import { ServiceName, verifyServiceToken } from './service-token';

/**
 * A guard for `/internal` routes that other services call: lets in a request
 * signed by one of `allowed` and nobody else. The gateway does not forward
 * `/internal`, and this is what stops anyone else who can reach the service.
 */
export function serviceCallGuard(...allowed: ServiceName[]): Type<CanActivate> {
  class ServiceCallGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const { headers } = context
        .switchToHttp()
        .getRequest<{ headers: Record<string, string | undefined> }>();
      const header = headers.authorization;
      const token = header?.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : null;

      try {
        if (token && allowed.includes(verifyServiceToken(token))) return true;
      } catch {
        // Falls through to the refusal below.
      }
      throw new UnauthorizedException();
    }
  }
  return ServiceCallGuard;
}
