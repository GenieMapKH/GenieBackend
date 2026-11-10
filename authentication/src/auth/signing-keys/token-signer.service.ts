import { Inject, Injectable } from '@nestjs/common';
import { tokenKeyId } from '@tilomnov/shared';
import * as jwt from 'jsonwebtoken';
import { SigningKeyStore } from './signing-key.store';

/** Signs this service's tokens with the current key, and checks the refresh tokens it gets back. */
@Injectable()
export class TokenSigner {
  constructor(
    @Inject(SigningKeyStore) private readonly keys: SigningKeyStore,
  ) {}

  /** RS256, with the key's id in the header so every service finds the right public key. */
  sign(payload: object, expiresIn: jwt.SignOptions['expiresIn']): string {
    const key = this.keys.signingKey();
    return jwt.sign(payload, key.privateKey, {
      algorithm: 'RS256',
      keyid: key.kid,
      expiresIn,
    });
  }

  /**
   * Verifies a refresh token, with any key still kept: one signed before the
   * last rotation still refreshes. Throws when it is invalid (or expired,
   * unless `ignoreExpiration`).
   */
  verifyRefreshToken<T extends object>(
    token: string,
    options: { ignoreExpiration?: boolean } = {},
  ): T {
    const key = this.keys.keptKey(tokenKeyId(token));
    if (!key) throw new Error('Unknown signing key');
    return jwt.verify(token, key, {
      algorithms: ['RS256'],
      ignoreExpiration: options.ignoreExpiration ?? false,
    }) as T;
  }
}
