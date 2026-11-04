import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { databaseCall } from '../database-call';

/**
 * A row of `account.refresh_tokens` (column names are the database's snake_case,
 * times are ISO strings).
 *
 * A session is one sign-in on one device: all the tokens it was given over
 * time share a `session_id`, and at most one of them is not revoked. Tokens
 * issued before sessions existed have none.
 */
export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  revoked: boolean;
  created_at: string;
  session_id: string | null;
  session_started_at: string | null;
  device_name: string | null;
  platform: string | null;
  ip_address: string | null;
  location: string | null;
}

/** The session a new token belongs to, and the device it was issued to. */
export interface SessionDetails {
  id: string;
  /** ISO time of the sign-in that started the session. */
  startedAt: string;
  deviceName: string | null;
  platform: string | null;
  ipAddress: string | null;
  location: string | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  session: SessionDetails;
}

const RECORD_COLUMNS = {
  id: true,
  userId: true,
  tokenHash: true,
  revoked: true,
  createdAt: true,
  sessionId: true,
  sessionStartedAt: true,
  deviceName: true,
  platform: true,
  ipAddress: true,
  location: true,
} satisfies Prisma.RefreshTokenSelect;

type RefreshTokenRow = Prisma.RefreshTokenGetPayload<{
  select: typeof RECORD_COLUMNS;
}>;

/** All reads and writes of the `refresh_tokens` table. */
@Injectable()
export class RefreshTokenRepository {
  private readonly logger = new Logger(RefreshTokenRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async insert(token: NewRefreshToken): Promise<void> {
    await databaseCall(this.logger, 'Failed to store refresh token', () =>
      this.prisma.refreshToken.create({
        data: {
          id: token.id,
          userId: token.userId,
          tokenHash: token.tokenHash,
          expiresAt: token.expiresAt,
          sessionId: token.session.id,
          sessionStartedAt: new Date(token.session.startedAt),
          deviceName: token.session.deviceName,
          platform: token.session.platform,
          ipAddress: token.session.ipAddress,
          location: token.session.location,
        },
        select: { id: true },
      }),
    );
  }

  async findById(id: string): Promise<RefreshTokenRecord | null> {
    const row = await databaseCall(this.logger, 'Failed to read token', () =>
      this.prisma.refreshToken.findUnique({
        where: { id },
        select: RECORD_COLUMNS,
      }),
    );
    return row ? toRecord(row) : null;
  }

  /**
   * Revokes a token only if it is still active.
   * Returns false when someone else already revoked it (a concurrent or replayed use).
   */
  async revokeIfActive(id: string): Promise<boolean> {
    const { count } = await databaseCall(
      this.logger,
      'Failed to revoke token',
      () =>
        this.prisma.refreshToken.updateMany({
          where: { id, revoked: false },
          data: { revoked: true },
        }),
    );
    return count > 0;
  }

  /** Revokes one token and returns the session it belonged to, if it had one. */
  async revokeById(id: string): Promise<string | null> {
    const rows = await databaseCall(this.logger, 'Failed to revoke token', () =>
      this.prisma.refreshToken.updateManyAndReturn({
        where: { id },
        data: { revoked: true },
        select: { sessionId: true },
      }),
    );
    return rows[0]?.sessionId ?? null;
  }

  /**
   * Revokes every usable token of the user, or every one outside
   * `exceptSessionId`. Returns the sessions that ended with them.
   */
  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string | null,
  ): Promise<string[]> {
    const where: Prisma.RefreshTokenWhereInput = { userId, revoked: false };
    if (exceptSessionId) {
      // Spelled out because `not` alone would skip the tokens that have no session.
      where.OR = [{ sessionId: null }, { sessionId: { not: exceptSessionId } }];
    }
    const rows = await databaseCall(
      this.logger,
      'Failed to revoke all sessions',
      () =>
        this.prisma.refreshToken.updateManyAndReturn({
          where,
          data: { revoked: true },
          select: { sessionId: true },
        }),
    );
    return rows.flatMap((row) => (row.sessionId ? [row.sessionId] : []));
  }

  /** Ends one session of the user. Returns false if they have no such active session. */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await databaseCall(
      this.logger,
      'Failed to revoke session',
      () =>
        this.prisma.refreshToken.updateMany({
          where: { userId, sessionId, revoked: false },
          data: { revoked: true },
        }),
    );
    return count > 0;
  }

  /** Whether the session still has a token that can be used. */
  async hasActiveToken(sessionId: string): Promise<boolean> {
    const row = await databaseCall(this.logger, 'Failed to check session', () =>
      this.prisma.refreshToken.findFirst({
        where: { sessionId, revoked: false },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  /** The usable token of each of the user's sessions, most recently used first. */
  async listSessionTokens(userId: string): Promise<RefreshTokenRecord[]> {
    const rows = await databaseCall(
      this.logger,
      'Failed to fetch sessions',
      () =>
        this.prisma.refreshToken.findMany({
          where: {
            userId,
            revoked: false,
            sessionId: { not: null },
            expiresAt: { gte: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          select: RECORD_COLUMNS,
        }),
    );
    return rows.map(toRecord);
  }

  async setLocation(id: string, location: string): Promise<void> {
    await databaseCall(this.logger, 'Failed to store session location', () =>
      this.prisma.refreshToken.updateMany({
        where: { id },
        data: { location },
      }),
    );
  }
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    user_id: row.userId,
    token_hash: row.tokenHash,
    revoked: row.revoked,
    created_at: row.createdAt.toISOString(),
    session_id: row.sessionId,
    session_started_at: row.sessionStartedAt?.toISOString() ?? null,
    device_name: row.deviceName,
    platform: row.platform,
    ip_address: row.ipAddress,
    location: row.location,
  };
}
