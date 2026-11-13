import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@tilomnov/prisma-client';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_TYPE,
  REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TYPE,
} from '../auth.constants';
import { ClientContext } from './client-context';
import { TokenSigner } from '../signing-keys/token-signer.service';
import { IpLocationProvider } from './ip-location.provider';
import { hashRefreshToken } from './refresh-token-hash';
import {
  RefreshTokenRecord,
  RefreshTokenRepository,
  SessionDetails,
} from './refresh-token.repository';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** A new pair, and the session it belongs to (kept on the server, not sent to the app). */
export interface IssuedTokens extends TokenPair {
  sessionId: string;
}

/** Signs a new access/refresh token pair and records the refresh token. */
@Injectable()
export class TokenIssuerService {
  private readonly logger = new Logger(TokenIssuerService.name);

  constructor(
    @Inject(TokenSigner) private readonly signer: TokenSigner,
    @Inject(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(IpLocationProvider) private readonly locations: IpLocationProvider,
  ) {}

  /**
   * A sign-in starts a new session. A refresh passes the token it replaces as
   * `previous`, and the new token continues that token's session.
   */
  async issue(
    userId: string,
    role: string,
    client: ClientContext,
    previous?: RefreshTokenRecord,
    adminEmailVerified = false,
    tx?: Prisma.TransactionClient,
  ): Promise<IssuedTokens> {
    if (previous && !tx)
      throw new Error('Refresh issuance requires the account transaction');
    const session = continueOrStartSession(client, previous);
    const adminMfa = role === 'admin' && adminEmailVerified;

    // `sid` names the session: it marks the asking device in the session list,
    // and is what a sign-out cuts off (see `RevokedSessionStore`).
    const accessToken = this.signer.sign(
      {
        sub: userId,
        role,
        typ: ACCESS_TOKEN_TYPE,
        sid: session.id,
        ...(adminMfa && { adminMfa: true }),
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );

    // The jti ties the signed token to its database row so it can be revoked.
    const jti = randomUUID();
    const refreshToken = this.signer.sign(
      {
        sub: userId,
        jti,
        typ: REFRESH_TOKEN_TYPE,
        ...(adminMfa && { adminMfa: true }),
      },
      `${REFRESH_TOKEN_TTL_DAYS}d`,
    );

    await this.refreshTokens.insert(
      {
        id: jti,
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        session,
      },
      tx,
    );
    if (session.ipAddress && !session.location) {
      this.locateInBackground(jti, session.ipAddress);
    }

    return { accessToken, refreshToken, sessionId: session.id };
  }

  /** The lookup calls another server, so signing in does not wait for it. */
  private locateInBackground(tokenId: string, ipAddress: string): void {
    this.locations
      .locate(ipAddress)
      .then((location) =>
        location
          ? this.refreshTokens.setLocation(tokenId, location)
          : undefined,
      )
      .catch((error: Error) =>
        this.logger.warn(`Session location not saved: ${error.message}`),
      );
  }

  private refreshExpiry(): Date {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
    return expiresAt;
  }
}

/**
 * The session of a new token. What the device says about itself now wins over
 * what the previous token recorded; the place is kept while the address is the same.
 */
export function continueOrStartSession(
  client: ClientContext,
  previous?: RefreshTokenRecord,
): SessionDetails {
  const ipAddress = client.ipAddress ?? previous?.ip_address ?? null;
  return {
    id: previous?.session_id ?? randomUUID(),
    startedAt:
      previous?.session_started_at ??
      previous?.created_at ??
      new Date().toISOString(),
    deviceName: client.deviceName ?? previous?.device_name ?? null,
    platform: client.platform ?? previous?.platform ?? null,
    ipAddress,
    location:
      previous && previous.ip_address === ipAddress ? previous.location : null,
  };
}
