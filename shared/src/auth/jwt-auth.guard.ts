import {
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { KeySetUnavailableError } from './auth-key-set';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest<TUser = any>(
    err: { message?: string } | undefined,
    user: any,
    info: { message?: string } | undefined,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    // Keys that cannot be loaded are our outage, not a bad token: a 401 would sign the app out.
    if (info instanceof KeySetUnavailableError) {
      this.logger.error(info.message);
      throw new ServiceUnavailableException('Please try again in a moment');
    }
    if (!user) {
      // The reason (invalid signature, expired, no key...) is what an operator needs to find a misconfigured service.
      this.logger.warn(
        `Token rejected: ${info?.message ?? err?.message ?? 'unknown reason'}`,
      );
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
