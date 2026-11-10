import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatAttachmentService } from './chat-attachment.service';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MALLORY = '99999999-9999-4999-8999-999999999999';
const FILE = '33333333-3333-4333-8333-333333333333';

describe('ChatAttachmentService', () => {
  const userTable = { findFirst: jest.fn() };
  const messageTable = { findMany: jest.fn() };
  const storage = {
    ensureBucket: jest.fn(),
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    removeFolder: jest.fn(),
    removeFiles: jest.fn(),
  };
  let service: ChatAttachmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    userTable.findFirst.mockResolvedValue({ id: BOB });
    storage.createSignedUploadUrl.mockResolvedValue(
      'https://storage.test/upload?token=t',
    );
    storage.createSignedDownloadUrl.mockResolvedValue(
      'https://storage.test/download?token=t',
    );
    service = new ChatAttachmentService(
      { user: userTable, message: messageTable } as never,
      storage as never,
    );
  });

  it('keeps attachments in a private, size-limited bucket', async () => {
    await service.onModuleInit();

    expect(storage.ensureBucket).toHaveBeenCalledWith('chat-attachments', {
      public: false,
      fileSizeLimit: 12 * 1024 * 1024,
    });
  });

  it('starts even if the bucket cannot be prepared', async () => {
    storage.ensureBucket.mockRejectedValue(new Error('storage down'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  describe('createUpload', () => {
    it('gives the sender one upload location that names both people', async () => {
      const upload = await service.createUpload(ALICE, BOB);

      expect(upload.path).toMatch(
        new RegExp(`^${ALICE}/${BOB}/[0-9a-f-]{36}$`),
      );
      expect(upload.uploadUrl).toBe('https://storage.test/upload?token=t');
      expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
        'chat-attachments',
        upload.path,
      );
    });

    it('never reuses a location', async () => {
      const first = await service.createUpload(ALICE, BOB);
      const second = await service.createUpload(ALICE, BOB);

      expect(first.path).not.toBe(second.path);
    });

    it('refuses an unknown or deactivated recipient, and a file to yourself', async () => {
      await expect(service.createUpload(ALICE, ALICE)).rejects.toThrow(
        BadRequestException,
      );

      userTable.findFirst.mockResolvedValue(null);
      await expect(service.createUpload(ALICE, BOB)).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('createDownloadUrl', () => {
    const location = { senderId: ALICE, recipientId: BOB, fileId: FILE };

    it.each([
      ['the sender', ALICE],
      ['the recipient', BOB],
    ])('gives %s a one-minute link', async (_who, userId) => {
      const result = await service.createDownloadUrl(userId, location);

      expect(result).toEqual({ url: 'https://storage.test/download?token=t' });
      expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(
        'chat-attachments',
        `${ALICE}/${BOB}/${FILE}`,
        60,
      );
    });

    it('gives nobody else a link, and does not even ask storage', async () => {
      await expect(
        service.createDownloadUrl(MALLORY, location),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('reports a file that does not exist', async () => {
      storage.createSignedDownloadUrl.mockResolvedValue(null);

      await expect(service.createDownloadUrl(BOB, location)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('erases both directions of a deleted account: what it sent and what it was sent', async () => {
    messageTable.findMany.mockResolvedValue([
      { senderId: BOB },
      { senderId: MALLORY },
    ]);

    await service.removeAllOf(ALICE);

    expect(messageTable.findMany.mock.calls[0][0]).toMatchObject({
      where: { recipientId: ALICE },
      distinct: ['senderId'],
    });
    expect(storage.removeFolder.mock.calls).toEqual([
      ['chat-attachments', ALICE],
      ['chat-attachments', `${BOB}/${ALICE}`],
      ['chat-attachments', `${MALLORY}/${ALICE}`],
    ]);
  });
  describe('the file of a deleted message', () => {
    const parties = { senderId: ALICE, recipientId: BOB };

    it('accepts a file the sender sent to the recipient', () => {
      expect(() =>
        service.requireSentFile(parties, `${ALICE}/${BOB}/${FILE}`),
      ).not.toThrow();
    });

    it.each([
      ['sent the other way', `${BOB}/${ALICE}/${FILE}`],
      ['of another conversation', `${ALICE}/${MALLORY}/${FILE}`],
      ['a whole folder', `${ALICE}/${BOB}`],
      ['deeper than a file', `${ALICE}/${BOB}/${FILE}/x`],
      ['not a file id', `${ALICE}/${BOB}/..`],
    ])('refuses a path %s', (_case, path) => {
      expect(() => service.requireSentFile(parties, path)).toThrow(
        BadRequestException,
      );
    });

    it('removes exactly that file', async () => {
      await service.removeFile(`${ALICE}/${BOB}/${FILE}`);

      expect(storage.removeFiles).toHaveBeenCalledWith('chat-attachments', [
        `${ALICE}/${BOB}/${FILE}`,
      ]);
    });
  });
});
