import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { tokenKeyId } from '@tilomnov/shared';
import { KeyObject } from 'crypto';
import { ACCESS_TOKEN_TYPE } from './auth.constants';
import { AuthenticatedUser } from './decorators/current-user.decorator';
import { RevokedSessionStore } from './sessions/revoked-session.store';
import { SigningKeyStore } from './signing-keys/signing-key.store';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(RevokedSessionStore) private readonly revoked: RevokedSessionStore,
    @Inject(SigningKeyStore) keys: SigningKeyStore,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Published keys only: an access token never verifies with a key kept just for refresh tokens.
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (error: unknown, key?: string) => void,
      ) => {
        try {
          const key = keys.publishedKey(tokenKeyId(rawJwtToken));
          if (key) done(null, pem(key));
          else done(new Error('Unknown signing key'));
        } catch (error) {
          done(error);
        }
      },
      algorithms: ['RS256'],
    });
  }

  /** `payload` is the verified JWT; the result becomes `req.user`. */
  async validate(payload: {
    sub: string;
    role: string;
    typ?: string;
    sid?: string;
  }): Promise<AuthenticatedUser> {
    if (payload.typ !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('Not an access token');
    }
    // The gateway does not check tokens on `/auth` routes, so a signed-out device is refused here.
    if (payload.sid && (await this.revoked.has(payload.sid))) {
      throw new UnauthorizedException('This device was signed out');
    }
    return {
      userId: payload.sub,
      role: payload.role,
      sessionId: payload.sid ?? null,
    };
  }
}

/** passport-jwt is typed for PEM strings, not key objects. */
function pem(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString();
}
