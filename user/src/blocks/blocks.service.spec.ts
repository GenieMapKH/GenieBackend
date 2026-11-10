import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('BlocksService', () => {
  const prisma = {
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    user: { findUnique: jest.fn() },
    userBlock: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    follow: { deleteMany: jest.fn() },
  };
  const chat = { blocked: jest.fn().mockResolvedValue(undefined) };
  const cache = {
    delete: jest.fn(),
    remember: jest.fn(
      (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    ),
  };
  let service: BlocksService;

  /** The rows of `user_blocks`, as the related-ids query reads them. */
  function blockRows(rows: { blockerId: string; blockedId: string }[]) {
    prisma.userBlock.findMany.mockResolvedValue(rows);
    prisma.userBlock.findUnique.mockImplementation(
      ({ where }: { where: { blockerId_blockedId: Record<string, string> } }) =>
        Promise.resolve(
          rows.find(
            (row) =>
              row.blockerId === where.blockerId_blockedId.blockerId &&
              row.blockedId === where.blockerId_blockedId.blockedId,
          ) ?? null,
        ),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlocksService(prisma as never, cache as never, chat as never);
    prisma.user.findUnique.mockResolvedValue({ id: THEM });
    blockRows([]);
  });

  describe('block', () => {
    it('blocks, unfollows both ways and forgets both accounts’ cached ids', async () => {
      blockRows([{ blockerId: ME, blockedId: THEM }]);

      await expect(service.block(ME, THEM)).resolves.toEqual({
        isBlocked: true,
        canMessage: false,
      });
      expect(prisma.userBlock.createMany).toHaveBeenCalledWith({
        data: [{ blockerId: ME, blockedId: THEM }],
        skipDuplicates: true,
      });
      expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { followerId: ME, followingId: THEM },
            { followerId: THEM, followingId: ME },
          ],
        },
      });
      for (const id of [ME, THEM]) {
        expect(cache.delete).toHaveBeenCalledWith(`blocks:related-ids:${id}`);
        expect(cache.delete).toHaveBeenCalledWith(
          `follows:following-ids:${id}`,
        );
      }
    });

    it('tells chat, so the two stop seeing each other online', async () => {
      await service.block(ME, THEM);
      expect(chat.blocked).toHaveBeenCalledWith(ME, THEM);
    });

    it('does not tell chat about an unblock', async () => {
      chat.blocked.mockClear();
      await service.unblock(ME, THEM);
      expect(chat.blocked).not.toHaveBeenCalled();
    });

    it('refuses yourself', async () => {
      await expect(service.block(ME, ME)).rejects.toThrow(BadRequestException);
      expect(prisma.userBlock.createMany).not.toHaveBeenCalled();
    });

    it('refuses an account that does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.block(ME, THEM)).rejects.toThrow(NotFoundException);
    });
  });

  describe('status', () => {
    it('tells the blocker they blocked, and that neither can message', async () => {
      blockRows([{ blockerId: ME, blockedId: THEM }]);
      await expect(service.status(ME, THEM)).resolves.toEqual({
        isBlocked: true,
        canMessage: false,
      });
    });

    it('tells the blocked person only that they cannot message', async () => {
      blockRows([{ blockerId: THEM, blockedId: ME }]);
      await expect(service.status(ME, THEM)).resolves.toEqual({
        isBlocked: false,
        canMessage: false,
      });
    });

    it('lets two people who have not blocked each other message', async () => {
      blockRows([{ blockerId: ME, blockedId: OTHER }]);
      await expect(service.status(ME, THEM)).resolves.toEqual({
        isBlocked: false,
        canMessage: true,
      });
    });
  });

  it('unblocks only what the viewer blocked, and forgets the cached ids', async () => {
    await expect(service.unblock(ME, THEM)).resolves.toEqual({
      isBlocked: false,
      canMessage: true,
    });
    expect(prisma.userBlock.deleteMany).toHaveBeenCalledWith({
      where: { blockerId: ME, blockedId: THEM },
    });
    expect(cache.delete).toHaveBeenCalledWith(`blocks:related-ids:${THEM}`);
  });

  it('eitherBlocked reads both directions', async () => {
    blockRows([
      { blockerId: ME, blockedId: THEM },
      { blockerId: OTHER, blockedId: ME },
    ]);
    await expect(service.eitherBlocked(ME, THEM)).resolves.toBe(true);
    await expect(service.eitherBlocked(ME, OTHER)).resolves.toBe(true);
    await expect(
      service.eitherBlocked(ME, '44444444-4444-4444-8444-444444444444'),
    ).resolves.toBe(false);
  });
});
