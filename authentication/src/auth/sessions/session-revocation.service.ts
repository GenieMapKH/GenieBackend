import { Inject, Injectable } from '@nestjs/common';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RevokedSessionStore } from './revoked-session.store';

/**
 * Ends sessions. Every sign-out goes through here, because ending a session
 * takes two things: revoking its refresh token, so it cannot be renewed, and
 * cutting off the access token the device already holds (`RevokedSessionStore`).
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    @Inject(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(RevokedSessionStore) private readonly revoked: RevokedSessionStore,
  ) {}

  /** Signs one device out. False if the user has no such active session. */
  async endSession(userId: string, sessionId: string): Promise<boolean> {
    const ended = await this.refreshTokens.revokeSession(userId, sessionId);
    if (ended) await this.revoked.add([sessionId]);
    return ended;
  }

  /** Signs the user out everywhere, or everywhere but `exceptSessionId`. */
  async endAllSessions(
    userId: string,
    exceptSessionId?: string | null,
  ): Promise<void> {
    await this.revoked.add(
      await this.refreshTokens.revokeAllForUser(userId, exceptSessionId),
    );
  }

  /** Signs out the device that holds this refresh token. */
  async endSessionOfToken(tokenId: string): Promise<void> {
    const sessionId = await this.refreshTokens.revokeById(tokenId);
    if (sessionId) await this.revoked.add([sessionId]);
  }
}
