import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JsonCache, PrismaService } from '@tilomnov/shared';
import { BlocksService } from '../blocks/blocks.service';
import { followingIdsKey } from './following-ids-key';

/** The most people one account may follow. It also bounds the feed query. */
export const MAX_FOLLOWING = 500;

/** Follow and unfollow drop the entry; this is only the safety net if Redis missed that. */
const FOLLOWING_IDS_TTL_SECONDS = 600;

/** What a profile shows about following: counts only, never who. */
export interface FollowSummary {
  followerCount: number;
  followingCount: number;
  /** Whether the viewer follows this account. Always false on their own. */
  isFollowing: boolean;
}

/**
 * Who follows whom. Lists of followers are never exposed to the app: only
 * the counts, and whether the viewer follows someone. The ids an account
 * follows are given to the property service only, for the feed.
 */
@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: JsonCache,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * Follows `targetId`. Following someone already followed changes nothing.
   * Two people where either has blocked the other cannot follow each other.
   */
  async follow(viewerId: string, targetId: string): Promise<FollowSummary> {
    if (viewerId === targetId) {
      throw new BadRequestException('You cannot follow yourself');
    }
    await this.requireVisible(targetId);
    if (await this.blocks.eitherBlocked(viewerId, targetId)) {
      throw new ForbiddenException('You cannot follow this account');
    }

    if (!(await this.isFollowing(viewerId, targetId))) {
      await this.requireRoomToFollow(viewerId);
      // Two taps at once: the second finds the row and adds nothing.
      await this.prisma.follow.createMany({
        data: [{ followerId: viewerId, followingId: targetId }],
        skipDuplicates: true,
      });
      await this.cache.delete(followingIdsKey(viewerId));
    }
    return this.summary(viewerId, targetId);
  }

  /**
   * Stops following `targetId`. Allowed even when that account is hidden,
   * so nobody is stuck following it; unfollowing twice changes nothing.
   */
  async unfollow(viewerId: string, targetId: string): Promise<FollowSummary> {
    await this.prisma.follow.deleteMany({
      where: { followerId: viewerId, followingId: targetId },
    });
    await this.cache.delete(followingIdsKey(viewerId));
    return this.summary(viewerId, targetId);
  }

  /** The counts on `targetId`'s profile, as `viewerId` sees them. */
  async profileSummary(
    viewerId: string,
    targetId: string,
  ): Promise<FollowSummary> {
    await this.requireVisible(targetId);
    return this.summary(viewerId, targetId);
  }

  /**
   * Everyone `userId` follows, most recently followed first: what the feed
   * reads listings from. Hidden accounts are included; the feed leaves their
   * listings out.
   */
  followingIds(userId: string): Promise<string[]> {
    return this.cache.remember(
      followingIdsKey(userId),
      FOLLOWING_IDS_TTL_SECONDS,
      async () => {
        const rows = await this.prisma.follow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map((row) => row.followingId);
      },
    );
  }

  /**
   * Everyone who follows `userId` and has not hidden their account: who is
   * told when they post a listing. Read only then, so it is not cached.
   */
  async followerIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.follow.findMany({
      where: { followingId: userId, follower: { deactivatedAt: null } },
      select: { followerId: true },
    });
    return rows.map((row) => row.followerId);
  }

  /** Counts leave out hidden (deactivated) accounts, as their profiles are hidden too. */
  private async summary(
    viewerId: string,
    targetId: string,
  ): Promise<FollowSummary> {
    const [followerCount, followingCount, isFollowing] = await Promise.all([
      this.prisma.follow.count({
        where: { followingId: targetId, follower: { deactivatedAt: null } },
      }),
      this.prisma.follow.count({
        where: { followerId: targetId, following: { deactivatedAt: null } },
      }),
      viewerId === targetId
        ? Promise.resolve(false)
        : this.isFollowing(viewerId, targetId),
    ]);
    return { followerCount, followingCount, isFollowing };
  }

  private async isFollowing(viewerId: string, targetId: string) {
    const row = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId: viewerId, followingId: targetId },
      },
      select: { followerId: true },
    });
    return row !== null;
  }

  /**
   * Counts every follow, hidden accounts too: the limit is what keeps the
   * feed query small, and hidden accounts are still in it.
   */
  private async requireRoomToFollow(viewerId: string): Promise<void> {
    const count = await this.prisma.follow.count({
      where: { followerId: viewerId },
    });
    if (count >= MAX_FOLLOWING) {
      throw new ConflictException(
        `You can follow at most ${MAX_FOLLOWING} people`,
      );
    }
  }

  /** A deactivated account is hidden, as if it did not exist. */
  private async requireVisible(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }
}
