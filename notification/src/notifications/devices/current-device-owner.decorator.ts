import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@tilomnov/shared';
import { DeviceOwner } from './push-devices.service';

/** The verified caller and session of a request behind `JwtAuthGuard`. */
export const CurrentDeviceOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DeviceOwner => {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException('User not authenticated');
    return { userId: user.userId, sessionId: user.sessionId };
  },
);
