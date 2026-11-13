import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenSigner } from '../signing-keys/token-signer.service';
import { UserRepository } from '../users/user.repository';
import { ClientContext } from './client-context';
import {
  EstablishedDeviceService,
  SessionCaller,
  sessionStartOf,
} from './established-device.service';
import { refreshTokenMatches } from './refresh-token-hash';
import {
  RefreshTokenRecord,
  RefreshTokenRepository,
} from './refresh-token.repository';
import { SessionRevocationService } from './session-revocation.service';
import { TokenIssuerService, TokenPair } from './token-issuer.service';

interface RefreshPayload {
  sub?: string;
  jti?: string;
  adminMfa?: boolean;
}

/** One signed-in device, as the app lists it. */
export interface DeviceSession {
  id: string;
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  location: string | null;
  signedInAt: string;
  lastUsedAt: string;
  /** True for the session that asked for the list. */
  current: boolean;
}

/** The devices signed in to an account, and what the asking device may do about them. */
export interface DeviceList {
  sessions: DeviceSession[];
  canSignOutOthers: boolean;
  /** When that becomes true. Null if this device's own session is not known. */
  canSignOutOthersFrom: string | null;
}

/** Refresh-token rotation, logout and the list of signed-in devices. */
@Injectable()
export class SessionService {
  constructor(
    @Inject(TokenSigner) private readonly signer: TokenSigner,
    @Inject(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(TokenIssuerService) private readonly issuer: TokenIssuerService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionRevocationService)
    private readonly revocations: SessionRevocationService,
    @Inject(EstablishedDeviceService)
    private readonly devices: EstablishedDeviceService,
  ) {}

  /** Exchanges a refresh token for a new pair; the old token can never be used again. */
  async refresh(
    refreshToken: string,
    client: ClientContext,
  ): Promise<TokenPair> {
    const { sub, jti, adminMfa } = this.verifyRefreshToken(refreshToken);

    const result = await this.refreshTokens.withUserLock(sub, async (tx) => {
      const record = await this.refreshTokens.findById(jti, tx);
      if (!record) {
        throw new UnauthorizedException('Refresh token not found');
      }
      if (record.user_id !== sub)
        throw new UnauthorizedException('Invalid refresh token owner');

      if (record.revoked) {
        return { revoked: record };
      }

      if (!(await refreshTokenMatches(refreshToken, record.token_hash))) {
        throw new UnauthorizedException('Invalid refresh token signature');
      }

      // Atomic: only one concurrent request can win the revoke.
      const won = await this.refreshTokens.revokeIfActive(jti, tx);
      if (!won) {
        return { theft: true };
      }

      const user = await this.users.findById(sub, tx);
      if (!user || user.banned_at || user.deactivated_at) {
        throw new UnauthorizedException('User no longer exists');
      }
      if (user.role === 'admin' && !adminMfa) {
        throw new UnauthorizedException(
          'Administrator email verification required',
        );
      }

      const { sessionId: _sessionId, ...tokens } = await this.issuer.issue(
        sub,
        user.role,
        client,
        record,
        adminMfa,
        tx,
      );
      return { tokens };
    });
    // Outside the transaction: theft revocation must commit, not roll back with a thrown 401.
    if (result.theft) {
      await this.revocations.endAllSessions(sub);
      throw new UnauthorizedException(
        'Token theft detected (Concurrent). All sessions revoked.',
      );
    }
    if (result.revoked) return this.rejectRevokedToken(result.revoked, sub);
    return result.tokens!;
  }

  /** Signs out the device that holds this refresh token. Expired tokens are accepted. */
  async logout(refreshToken: string): Promise<{ message: string }> {
    let payload: RefreshPayload;
    try {
      payload = this.signer.verifyRefreshToken<RefreshPayload>(refreshToken, {
        ignoreExpiration: true,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload.jti) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    await this.revocations.endSessionOfToken(payload.jti);
    return { message: 'Logged out successfully' };
  }

  async listSessions(caller: SessionCaller): Promise<DeviceList> {
    const tokens = await this.refreshTokens.listSessionTokens(caller.userId);
    const established = this.devices.statusAmong(tokens, caller);

    return {
      sessions: tokens.map((token) => ({
        id: token.session_id!,
        deviceName: token.device_name,
        platform: token.platform,
        ipAddress: token.ip_address,
        location: token.location,
        signedInAt: sessionStartOf(token),
        // Each use replaces the token, so the live token's age is the time since the last use.
        lastUsedAt: token.created_at,
        current: token.session_id === caller.sessionId,
      })),
      canSignOutOthers: established.isEstablished,
      canSignOutOthersFrom: established.from?.toISOString() ?? null,
    };
  }

  /** Signs one device out, at once. Signing out another device than the caller's needs an established device. */
  async revokeSession(
    caller: SessionCaller,
    sessionId: string,
  ): Promise<{ message: string }> {
    if (sessionId !== caller.sessionId) {
      await this.devices.require(caller);
    }
    if (!(await this.revocations.endSession(caller.userId, sessionId))) {
      throw new NotFoundException('Session not found');
    }
    return { message: 'Device signed out' };
  }

  /** Signs every device out, the caller's included. */
  async logoutAll(caller: SessionCaller): Promise<{ message: string }> {
    await this.devices.require(caller);
    await this.revocations.endAllSessions(caller.userId);
    return { message: 'All sessions revoked successfully' };
  }

  /**
   * A revoked token is being presented. If its session has moved on to a newer
   * token, two parties hold tokens of one session: it was stolen, so every
   * session ends. If the session has no usable token, the device was simply
   * signed out (here or from another device) and only needs to log in again.
   */
  private async rejectRevokedToken(
    record: RefreshTokenRecord,
    userId: string,
  ): Promise<never> {
    const signedOut =
      record.session_id !== null &&
      !(await this.refreshTokens.hasActiveToken(record.session_id));
    if (signedOut) {
      throw new UnauthorizedException(
        'This device was signed out. Please log in again.',
      );
    }

    await this.revocations.endAllSessions(userId);
    throw new UnauthorizedException(
      'Token theft detected. All sessions revoked.',
    );
  }

  private verifyRefreshToken(token: string): {
    sub: string;
    jti: string;
    adminMfa: boolean;
  } {
    let payload: RefreshPayload;
    try {
      payload = this.signer.verifyRefreshToken<RefreshPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (!payload.sub || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }
    return {
      sub: payload.sub,
      jti: payload.jti,
      adminMfa: payload.adminMfa === true,
    };
  }
}
