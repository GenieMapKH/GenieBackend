import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Who is calling, as `JwtStrategy` read it from a verified access token. */
export interface AuthenticatedUser {
  userId: string;
  role: string;
  /** The sign-in the token belongs to. Null for a token issued before sessions existed. */
  sessionId: string | null;
}

/** Injects the [AuthenticatedUser]. Only for routes behind `JwtAuthGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
