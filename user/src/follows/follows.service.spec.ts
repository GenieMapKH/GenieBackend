import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FollowsService, MAX_FOLLOWING } from './follows.service';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';

describe('FollowsService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    follow: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const cache = {
    delete: jest.fn(),
    remember: jest.fn(
      (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    ),
  };
  const blocks = { eitherBlocked: jest.fn() };
  let service: FollowsService;

  /** `count` answers by what it is asked: followers of, following of, or the limit check. */
  function counts(followers: number, following: number, mine = 0) {
    prisma.follow.count.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('followingId' in where) return Promise.resolve(followers);
        if ('following' in where) return Promise.resolve(following);
        return Promise.resolve(mine);
      },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FollowsService(
      prisma as never,
      cache as never,
      blocks as never,
    );
    blocks.eitherBlocked.mockResolvedValue(false);
    prisma.user.findFirst.mockResolvedValue({ id: THEM });
    prisma.follow.findUnique.mockResolvedValue(null);
    counts(0, 0);
  });

  describe('follow', () => {
    it('refuses when either has blocked the other, and adds nothing', async () => {
      blocks.eitherBlocked.mockResolvedValue(true);

      await expect(service.follow(ME, THEM)).rejects.toThrow(
        ForbiddenException,
      );
      expect(blocks.eitherBlocked).toHaveBeenCalledWith(ME, THEM);
      expect(prisma.follow.createMany).not.toHaveBeenCalled();
    });

    it('adds the follow, clears the cached ids, and answers the new counts', async () => {
      prisma.follow.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ followerId: ME });
      counts(1, 4);

      await expect(service.follow(ME, THEM)).resolves.toEqual({
        followerCount: 1,
        followingCount: 4,
        isFollowing: true,
      });
      expect(prisma.follow.createMany).toHaveBeenCalledWith({
        data: [{ followerId: ME, followingId: THEM }],
        skipDuplicates: true,
      });
      expect(cache.delete).toHaveBeenCalledWith(`follows:following-ids:${ME}`);
    });

    it('changes nothing when already following', async () => {
      prisma.follow.findUnique.mockResolvedValue({ followerId: ME });

      const summary = await service.follow(ME, THEM);

      expect(summary.isFollowing).toBe(true);
      expect(prisma.follow.createMany).not.toHaveBeenCalled();
    });

    it('refuses following yourself', async () => {
      await expect(service.follow(ME, ME)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.follow.createMany).not.toHaveBeenCalled();
    });

    it('refuses an account that does not exist or is hidden', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.follow(ME, THEM)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: THEM, deactivatedAt: null },
        }),
      );
    });

    it(`refuses a new follow once ${MAX_FOLLOWING} are reached`, async () => {
      counts(0, 0, MAX_FOLLOWING);

      await expect(service.follow(ME, THEM)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.follow.createMany).not.toHaveBeenCalled();
    });

    it('still allows one below the limit', async () => {
      counts(0, 0, MAX_FOLLOWING - 1);

      await service.follow(ME, THEM);

      expect(prisma.follow.createMany).toHaveBeenCalled();
    });
  });

  describe('unfollow', () => {
    it('removes the follow and clears the cached ids, even for a hidden account', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      counts(0, 2);

      await expect(service.unfollow(ME, THEM)).resolves.toEqual({
        followerCount: 0,
        followingCount: 2,
        isFollowing: false,
      });
      expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
        where: { followerId: ME, followingId: THEM },
      });
      expect(cache.delete).toHaveBeenCalledWith(`follows:following-ids:${ME}`);
    });
  });

  describe('profileSummary', () => {
    it('counts only accounts that are not hidden', async () => {
      counts(7, 3);

      await expect(service.profileSummary(ME, THEM)).resolves.toEqual({
        followerCount: 7,
        followingCount: 3,
        isFollowing: false,
      });
      expect(prisma.follow.count).toHaveBeenCalledWith({
        where: { followingId: THEM, follower: { deactivatedAt: null } },
      });
      expect(prisma.follow.count).toHaveBeenCalledWith({
        where: { followerId: THEM, following: { deactivatedAt: null } },
      });
    });

    it('never says you follow yourself', async () => {
      prisma.follow.findUnique.mockResolvedValue({ followerId: ME });

      const summary = await service.profileSummary(ME, ME);

      expect(summary.isFollowing).toBe(false);
      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('is a 404 for a hidden account', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.profileSummary(ME, THEM)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('followingIds', () => {
    it('reads the followed ids through the cache, newest first', async () => {
      prisma.follow.findMany.mockResolvedValue([
        { followingId: THEM },
        { followingId: 'x' },
      ]);

      await expect(service.followingIds(ME)).resolves.toEqual([THEM, 'x']);
      expect(cache.remember).toHaveBeenCalledWith(
        `follows:following-ids:${ME}`,
        expect.any(Number),
        expect.any(Function),
      );
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followerId: ME },
        select: { followingId: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
