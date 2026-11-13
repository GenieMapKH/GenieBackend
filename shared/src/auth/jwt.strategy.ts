import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { KeyObject } from 'crypto';
import { authKeySet } from './auth-key-set';
import { tokenKeyId } from './signed-token';
import { requireActiveSession } from './active-session';

interface AccessTokenPayload {
  sub: string;
  role: string;
  typ?: string;
  /** The session (signed-in device). Missing from tokens issued before sessions existed. */
  sid?: string;
  adminMfa?: boolean;
}

/** What `req.user` holds once the access token is verified. */
export interface AuthenticatedUser {
  userId: string;
  role: string;
  sessionId: string | null;
  adminMfa: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      // The key named by the token's `kid`, from the authentication service's JWKS.
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (error: unknown, key?: string) => void,
      ) => {
        Promise.resolve()
          .then(() => authKeySet().key(tokenKeyId(rawJwtToken)))
          .then(
            (key) => done(null, pem(key)),
            (error: unknown) => done(error),
          );
      },
      algorithms: ['RS256'],
    });
  }

  async validate(
    request: { headers: { authorization?: string } },
    payload: AccessTokenPayload,
  ): Promise<AuthenticatedUser> {
    // Refresh tokens are signed with the same key and must not open the API.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Not an access token');
    }
    if (!payload.sid || !payload.sub)
      throw new UnauthorizedException('Sign in again');
    if (payload.role === 'admin' && payload.adminMfa !== true)
      throw new UnauthorizedException(
        'Administrator email verification required',
      );
    const token = request.headers.authorization?.match(/^Bearer +(\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Sign-in required');
    await requireActiveSession(token);
    return {
      userId: payload.sub,
      role: payload.role,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      adminMfa: payload.adminMfa === true,
    };
  }
}

/** passport-jwt is typed for PEM strings, not key objects. */
function pem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}
