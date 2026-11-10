import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  EDIT_WINDOW_MS,
  MessageActionsService,
} from './message-actions.service';

describe('MessageActionsService', () => {
  const messageTable = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const hiddenTable = { createMany: jest.fn() };
  const prisma = { message: messageTable, chatHiddenMessage: hiddenTable };
  const attachments = { requireSentFile: jest.fn(), removeFile: jest.fn() };
  let service: MessageActionsService;

  const fromAliceToBob = { senderId: 'alice', recipientId: 'bob' };
  const edit = { ciphertext: 'new-cipher', nonce: 'new-nonce' };
  const now = new Date('2026-10-20T12:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    messageTable.findUnique.mockResolvedValue(fromAliceToBob);
    messageTable.updateMany.mockResolvedValue({ count: 1 });
    messageTable.findUniqueOrThrow.mockResolvedValue({
      id: 'm-1',
      ...fromAliceToBob,
      ...edit,
      editedAt: now,
    });
    messageTable.deleteMany.mockResolvedValue({ count: 1 });
    service = new MessageActionsService(
      prisma as never,
      attachments as never,
      { seal: (body: unknown) => body, view: (body: unknown) => body } as never,
    );
  });

  describe('edit', () => {
    it("replaces the sender's text and marks when it was edited", async () => {
      const edited = await service.edit('alice', 'm-1', edit, now);

      expect(messageTable.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'm-1',
          senderId: 'alice',
          createdAt: { gt: new Date(now.getTime() - EDIT_WINDOW_MS) },
        },
        data: { ciphertext: 'new-cipher', nonce: 'new-nonce', editedAt: now },
      });
      expect(edited).toMatchObject({
        id: 'm-1',
        ciphertext: 'new-cipher',
        editedAt: now,
      });
    });

    it('allows an hour after sending', () => {
      expect(EDIT_WINDOW_MS).toBe(60 * 60 * 1000);
    });

    it('refuses once the hour has passed', async () => {
      messageTable.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.edit('alice', 'm-1', edit, now)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("refuses the other person's message", async () => {
      await expect(service.edit('bob', 'm-1', edit, now)).rejects.toThrow(
        ForbiddenException,
      );
      expect(messageTable.updateMany).not.toHaveBeenCalled();
    });

    it('says a message of another conversation does not exist', async () => {
      await expect(service.edit('mallory', 'm-1', edit, now)).rejects.toThrow(
        NotFoundException,
      );
      expect(messageTable.updateMany).not.toHaveBeenCalled();
    });

    it('says an unknown message does not exist', async () => {
      messageTable.findUnique.mockResolvedValue(null);

      await expect(service.edit('alice', 'm-1', edit, now)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete for me', () => {
    it('hides a message from the caller only, whoever sent it', async () => {
      await expect(service.deleteForMe('bob', 'm-1')).resolves.toEqual(
        fromAliceToBob,
      );

      expect(hiddenTable.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'bob', messageId: 'm-1' }],
        skipDuplicates: true,
      });
      expect(messageTable.deleteMany).not.toHaveBeenCalled();
    });

    it('cannot hide a message of another conversation', async () => {
      await expect(service.deleteForMe('mallory', 'm-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(hiddenTable.createMany).not.toHaveBeenCalled();
    });
  });

  describe('delete for everyone', () => {
    const file = 'alice/bob/33333333-3333-4333-8333-333333333333';

    it('deletes the message itself, and its file', async () => {
      await expect(
        service.deleteForEveryone('alice', 'm-1', file),
      ).resolves.toEqual(fromAliceToBob);

      expect(attachments.requireSentFile).toHaveBeenCalledWith(
        fromAliceToBob,
        file,
      );
      expect(messageTable.deleteMany).toHaveBeenCalledWith({
        where: { id: 'm-1', senderId: 'alice' },
      });
      expect(attachments.removeFile).toHaveBeenCalledWith(file);
    });

    it('deletes a message without a file', async () => {
      await service.deleteForEveryone('alice', 'm-1');

      expect(messageTable.deleteMany).toHaveBeenCalled();
      expect(attachments.removeFile).not.toHaveBeenCalled();
    });

    it('only lets the sender delete for everyone', async () => {
      await expect(service.deleteForEveryone('bob', 'm-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(messageTable.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes nothing when the file named is not the message's", async () => {
      attachments.requireSentFile.mockImplementationOnce(() => {
        throw new BadRequestException(
          'This file does not belong to the message',
        );
      });

      await expect(
        service.deleteForEveryone('alice', 'm-1', 'bob/alice/x'),
      ).rejects.toThrow(BadRequestException);
      expect(messageTable.deleteMany).not.toHaveBeenCalled();
      expect(attachments.removeFile).not.toHaveBeenCalled();
    });

    it('still deletes the message when its file cannot be deleted', async () => {
      attachments.removeFile.mockRejectedValue(new Error('storage down'));

      await expect(
        service.deleteForEveryone('alice', 'm-1', file),
      ).resolves.toEqual(fromAliceToBob);
      expect(messageTable.deleteMany).toHaveBeenCalled();
    });

    it('says a message already deleted does not exist', async () => {
      messageTable.findUnique.mockResolvedValue(null);

      await expect(service.deleteForEveryone('alice', 'm-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
