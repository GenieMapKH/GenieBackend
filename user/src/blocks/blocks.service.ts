import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JsonCache, PrismaService } from '@tilomnov/shared';
import { followingIdsKey } from '../follows/following-ids-key';
import { ChatBlockNotice } from './chat-block-notice';

/** Block and unblock drop the entry; this is only the safety net if Redis missed that. */
const RELATED_IDS_TTL_SECONDS = 600;

/** The ids an account has blocked, or been blocked by: what every check reads. */
function relatedIdsKey(userId: string): string {
  return `blocks:related-ids:${userId}`;
}

/**
 * What an account sees about another. `canMessage` is false when either has
 * blocked the other; whether the other did is not said apart from that.
 */
export interface BlockStatus {
  isBlocked: boolean;
  canMessage: boolean;
}

/** Someone the viewer blocked, for the list they unblock from. */
export interface BlockedAccount {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  blockedAt: Date;
}

/** The longest list of blocked accounts returned at once. */
const MAX_LISTED = 500;

/**
 * Blocking: the two stop following each other and can no longer follow,
 * message or call each other. The other person is not told; they only find
 * they cannot reach the blocker.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: JsonCache,
    private readonly chat: ChatBlockNotice,
  ) {}

  /** Blocks `targetId`. Blocking twice changes nothing. */
  async block(viewerId: string, targetId: string): Promise<BlockStatus> {
    if (viewerId === targetId) {
      throw new BadRequestException('You cannot block yourself');
    }
    await this.requireExists(targetId);

    const operations = (db: Pick<PrismaService, 'userBlock' | 'follow'>) => [
      db.userBlock.createMany({
        data: [{ blockerId: viewerId, blockedId: targetId }],
        skipDuplicates: true,
      }),
      db.follow.deleteMany({
        where: {
          OR: [
            { followerId: viewerId, followingId: targetId },
            { followerId: targetId, followingId: viewerId },
          ],
        },
      }),
    ];
    if (this.chat.queued) {
      await this.prisma.$transaction(async (tx) => {
        for (const operation of operations(tx)) await operation;
        await this.chat.blocked(viewerId, targetId, tx);
      });
    } else await this.prisma.$transaction(operations(this.prisma));
    await this.forget(viewerId, targetId);
    if (!this.chat.queued) await this.chat.blocked(viewerId, targetId);
    return this.status(viewerId, targetId);
  }

  /** Unblocks `targetId`. Follows removed by the block do not come back. */
  async unblock(viewerId: string, targetId: string): Promise<BlockStatus> {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: viewerId, blockedId: targetId },
    });
    await this.forget(viewerId, targetId);
    return this.status(viewerId, targetId);
  }

  async status(viewerId: string, targetId: string): Promise<BlockStatus> {
    if (viewerId === targetId) return { isBlocked: false, canMessage: true };
    const row = await this.prisma.userBlock.findUnique({
      where: {
        blockerId_blockedId: { blockerId: viewerId, blockedId: targetId },
      },
      select: { blockerId: true },
    });
    return {
      isBlocked: row !== null,
      canMessage: !(await this.eitherBlocked(viewerId, targetId)),
    };
  }

  /** The accounts `viewerId` blocked, most recently blocked first. */
  async blockedBy(viewerId: string): Promise<BlockedAccount[]> {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: viewerId },
      orderBy: { createdAt: 'desc' },
      take: MAX_LISTED,
      select: {
        createdAt: true,
        blocked: {
          select: { id: true, name: true, username: true, avatarUrl: true },
        },
      },
    });
    return rows.map((row) => ({ ...row.blocked, blockedAt: row.createdAt }));
  }

  /** Whether either of the two has blocked the other. */
  async eitherBlocked(userId: string, otherId: string): Promise<boolean> {
    return (await this.relatedIds(userId)).includes(otherId);
  }

  private relatedIds(userId: string): Promise<string[]> {
    return this.cache.remember(
      relatedIdsKey(userId),
      RELATED_IDS_TTL_SECONDS,
      async () => {
        const rows = await this.prisma.userBlock.findMany({
          where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
          select: { blockerId: true, blockedId: true },
        });
        return rows.map((row) =>
          row.blockerId === userId ? row.blockedId : row.blockerId,
        );
      },
    );
  }

  /** Both accounts' cached block and follow ids are out of date. */
  private async forget(viewerId: string, targetId: string): Promise<void> {
    await Promise.all(
      [viewerId, targetId].flatMap((id) => [
        this.cache.delete(relatedIdsKey(id)),
        this.cache.delete(followingIdsKey(id)),
      ]),
    );
  }

  /** A deactivated account can be blocked too: it may come back. */
  private async requireExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }
}
