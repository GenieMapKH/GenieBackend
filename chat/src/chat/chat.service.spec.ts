import { MessageProtection } from './message-protection';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { BlockedException } from './block-checker';

describe('ChatService', () => {
  const messageTable = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  };
  const userTable = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    message: messageTable,
    user: userTable,
    $queryRaw: jest.fn(),
  };
  const states = { clearedAt: jest.fn() };
  const notifications = { chatMessage: jest.fn() };
  const blocks = { requireNotBlocked: jest.fn() };
  let service: ChatService;

  const sender = {
    username: 'Dara',
    email: null,
    phone: null,
    avatarUrl: null,
  };
  const stored = {
    id: 'm-1',
    senderId: 'alice',
    recipientId: 'bob',
    ciphertext: 'cipher',
    nonce: 'nonce',
    readAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    sender,
  };
  const newMessage = {
    id: 'm-1',
    recipientId: 'bob',
    ciphertext: 'cipher',
    nonce: 'nonce',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete (notifications as { queued?: boolean }).queued;
    userTable.findUnique.mockResolvedValue({
      id: 'bob',
      backupBlob: null,
      keyBackup: { protectedBy: 'pin' },
    });
    // How another person is looked up: only if their account is not deactivated.
    userTable.findFirst.mockResolvedValue({ id: 'bob' });
    messageTable.create.mockResolvedValue(stored);
    states.clearedAt.mockResolvedValue(null);
    service = new ChatService(
      prisma as never,
      states as never,
      notifications as never,
      blocks as never,
      {
        seal: (body: unknown) => body,
        open: (body: unknown) => body,
        view: (body: unknown) => body,
      } as never,
    );
    blocks.requireNotBlocked.mockResolvedValue(undefined);
  });

  it('commits a queued push in the same transaction as its new message', async () => {
    Object.assign(notifications, { queued: true });
    const transaction = jest.fn((run) => run(prisma));
    Object.assign(prisma, { $transaction: transaction });
    await service.sendMessage('alice', newMessage);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifications.chatMessage).toHaveBeenCalledTimes(1);
    expect(notifications.chatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: stored.id }),
      prisma,
    );
  });

  it('rejects a new message when its transactional outbox write fails', async () => {
    Object.assign(notifications, { queued: true });
    Object.assign(prisma, { $transaction: jest.fn((run) => run(prisma)) });
    notifications.chatMessage.mockRejectedValueOnce(
      new Error('outbox unavailable'),
    );
    await expect(service.sendMessage('alice', newMessage)).rejects.toThrow(
      'outbox unavailable',
    );
  });

  it('stores a managed message encrypted and returns it only after opening it', async () => {
    process.env.CHAT_MESSAGE_SECRET = 'test-only-chat-message-storage-secret';
    try {
      const protection = new MessageProtection();
      const managed = {
        id: 'm-1',
        recipientId: 'bob',
        nonce: 'managed-v1',
        ciphertext: Buffer.from(
          JSON.stringify({
            v: 1,
            id: 'm-1',
            from: 'alice',
            to: 'bob',
            text: 'private',
          }),
        ).toString('base64'),
      };
      service = new ChatService(
        prisma as never,
        states as never,
        notifications as never,
        blocks as never,
        protection,
      );
      messageTable.create.mockImplementation(async ({ data }) => ({
        ...stored,
        ...data,
        sender,
      }));
      const received = await service.sendMessage('alice', managed);
      expect(messageTable.create.mock.calls[0][0].data.ciphertext).not.toBe(
        managed.ciphertext,
      );
      expect(received.ciphertext).toBe(managed.ciphertext);
      expect(received.nonce).toBe('managed-v1');
      expect(notifications.chatMessage.mock.calls[0][0].ciphertext).not.toBe(
        managed.ciphertext,
      );
    } finally {
      delete process.env.CHAT_MESSAGE_SECRET;
    }
  });

  describe('sendMessage', () => {
    it('refuses, stores nothing and pushes nothing when either has blocked the other', async () => {
      blocks.requireNotBlocked.mockRejectedValue(new BlockedException());

      await expect(service.sendMessage('alice', newMessage)).rejects.toThrow(
        BlockedException,
      );
      expect(blocks.requireNotBlocked).toHaveBeenCalledWith('alice', 'bob');
      expect(messageTable.create).not.toHaveBeenCalled();
      expect(notifications.chatMessage).not.toHaveBeenCalled();
    });

    it('stores the ciphertext under the id the device chose', async () => {
      const message = await service.sendMessage('alice', newMessage);

      expect(messageTable.create.mock.calls[0][0].data).toEqual({
        id: 'm-1',
        senderId: 'alice',
        recipientId: 'bob',
        ciphertext: 'cipher',
        nonce: 'nonce',
        replyToId: null,
      });
      expect(message).toMatchObject({
        id: 'm-1',
        senderId: 'alice',
        senderName: 'Dara',
        senderAvatar: null,
      });
      expect(message).not.toHaveProperty('sender');
    });

    it("pushes a new message to the recipient's phones, with the sealed message and never its text", async () => {
      await service.sendMessage('alice', newMessage);

      expect(notifications.chatMessage).toHaveBeenCalledWith({
        recipientId: 'bob',
        senderId: 'alice',
        senderName: 'Dara',
        messageId: 'm-1',
        ciphertext: 'cipher',
        nonce: 'nonce',
      });
    });

    it('returns the stored message when the same id is sent again', async () => {
      messageTable.create.mockRejectedValue({ code: 'P2002' });
      messageTable.findUnique.mockResolvedValue(stored);

      const message = await service.sendMessage('alice', newMessage);

      expect(message.id).toBe('m-1');
      expect(messageTable.create).toHaveBeenCalledTimes(1);
      // The first attempt already pushed it.
      expect(notifications.chatMessage).not.toHaveBeenCalled();
    });

    it("refuses an id that belongs to someone else's message", async () => {
      messageTable.create.mockRejectedValue({ code: 'P2002' });
      messageTable.findUnique.mockResolvedValue({
        ...stored,
        senderId: 'mallory',
      });

      await expect(service.sendMessage('alice', newMessage)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects an unknown or deactivated recipient without storing anything', async () => {
      userTable.findFirst.mockResolvedValue(null);

      await expect(service.sendMessage('alice', newMessage)).rejects.toThrow(
        NotFoundException,
      );
      expect(messageTable.create).not.toHaveBeenCalled();
    });

    it('checks the sender, the recipient and the quoted message at the same time', async () => {
      const pending: (() => void)[] = [];
      const held = <T>(value: T) =>
        new Promise<T>((resolve) => pending.push(() => resolve(value)));
      userTable.findUnique.mockImplementation(() =>
        held({ backupBlob: null, keyBackup: { protectedBy: 'pin' } }),
      );
      userTable.findFirst.mockImplementation(() => held({ id: 'bob' }));
      messageTable.findFirst.mockImplementation(() => held({ id: 'm-0' }));

      const sending = service.sendMessage('alice', {
        ...newMessage,
        replyToId: 'm-0',
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(pending).toHaveLength(2);
      pending.forEach((answer) => answer());
      await sending;
      expect(messageTable.create.mock.calls[0][0].data.replyToId).toBe('m-0');
    });

    it('rejects a message to yourself', async () => {
      await expect(service.sendMessage('bob', newMessage)).rejects.toThrow(
        BadRequestException,
      );
      expect(messageTable.create).not.toHaveBeenCalled();
    });

    it('does not hide unexpected database errors', async () => {
      messageTable.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.sendMessage('alice', newMessage)).rejects.toThrow(
        'connection lost',
      );
    });

    it('allows messaging without a chat PIN or key backup', async () => {
      userTable.findUnique.mockResolvedValue({
        backupBlob: null,
        keyBackup: null,
      });
      await expect(
        service.sendMessage('alice', newMessage),
      ).resolves.toMatchObject({ id: 'm-1' });
      expect(userTable.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getConversations', () => {
    const row = (
      partnerId: string,
      createdAt: string,
      state: { archivedAt?: string; clearedAt?: string } = {},
    ) => ({
      partnerId,
      id: `last-${partnerId}`,
      senderId: partnerId,
      ciphertext: 'cipher',
      nonce: 'nonce',
      createdAt: new Date(createdAt),
      readAt: null,
      archivedAt: state.archivedAt ? new Date(state.archivedAt) : null,
      clearedAt: state.clearedAt ? new Date(state.clearedAt) : null,
    });
    const people = [
      { id: 'bob', username: 'Bob', email: null, phone: null, avatarUrl: null },
      {
        id: 'carol',
        username: 'Carol',
        email: null,
        phone: null,
        avatarUrl: null,
      },
    ];

    it('returns one row per partner, newest conversation first, with unread counts', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          row('bob', '2026-01-01T10:00:00Z'),
          row('carol', '2026-01-02T10:00:00Z'),
        ])
        .mockResolvedValueOnce([{ senderId: 'bob', count: 3 }]);
      userTable.findMany.mockResolvedValue([
        {
          id: 'bob',
          username: 'Bob',
          email: null,
          phone: null,
          avatarUrl: 'bob.png',
          role: 'admin',
        },
        {
          id: 'carol',
          username: null,
          email: null,
          phone: null,
          avatarUrl: null,
        },
      ]);

      const conversations = await service.getConversations('alice');

      expect(conversations).toEqual([
        {
          participantId: 'carol',
          participantName: 'Property Owner',
          participantAvatar: null,
          participantIsAdmin: false,
          lastMessage: expect.objectContaining({
            id: 'last-carol',
            senderId: 'carol',
            ciphertext: 'cipher',
          }),
          unreadCount: 0,
        },
        {
          participantId: 'bob',
          participantName: 'Bob',
          participantAvatar: 'bob.png',
          participantIsAdmin: true,
          lastMessage: expect.objectContaining({ id: 'last-bob' }),
          unreadCount: 3,
        },
      ]);
      expect(conversations[0].lastMessage).not.toHaveProperty('partnerId');
      expect(conversations[0].lastMessage).not.toHaveProperty('archivedAt');
    });

    it('leaves out a conversation with a deactivated account, unread messages included', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          row('bob', '2026-01-01T10:00:00Z'),
          row('carol', '2026-01-02T10:00:00Z'),
        ])
        .mockResolvedValueOnce([{ senderId: 'carol', count: 2 }]);
      // Carol deactivated her account, so the query for visible partners does not return her.
      userTable.findMany.mockResolvedValue([
        {
          id: 'bob',
          name: 'Bob',
          username: 'bob',
          email: null,
          phone: null,
          avatarUrl: null,
        },
      ]);

      const conversations = await service.getConversations('alice');

      expect(
        conversations.map((conversation) => conversation.participantId),
      ).toEqual(['bob']);
      expect(userTable.findMany.mock.calls[0][0].where).toMatchObject({
        deactivatedAt: null,
      });
    });

    it('keeps an archived conversation out of the main list and in the archive', async () => {
      const rows = [
        row('bob', '2026-01-01T10:00:00Z', {
          archivedAt: '2026-01-01T11:00:00Z',
        }),
        row('carol', '2026-01-02T10:00:00Z'),
      ];
      userTable.findMany.mockResolvedValue(people);

      prisma.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
      const main = await service.getConversations('alice', 'main');
      prisma.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
      const archived = await service.getConversations('alice', 'archived');

      expect(main.map((c) => c.participantId)).toEqual(['carol']);
      expect(archived.map((c) => c.participantId)).toEqual(['bob']);
    });

    it('brings an archived conversation back when a newer message arrives', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          row('bob', '2026-01-03T10:00:00Z', {
            archivedAt: '2026-01-01T11:00:00Z',
          }),
        ])
        .mockResolvedValueOnce([]);
      userTable.findMany.mockResolvedValue(people);

      const main = await service.getConversations('alice', 'main');

      expect(main.map((c) => c.participantId)).toEqual(['bob']);
    });

    it('hides a conversation deleted for me until a newer message arrives', async () => {
      const rows = [
        row('bob', '2026-01-01T10:00:00Z', {
          clearedAt: '2026-01-01T11:00:00Z',
        }),
        row('carol', '2026-01-03T10:00:00Z', {
          clearedAt: '2026-01-02T00:00:00Z',
        }),
      ];
      userTable.findMany.mockResolvedValue(people);

      prisma.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
      const main = await service.getConversations('alice', 'main');
      prisma.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
      const archived = await service.getConversations('alice', 'archived');

      expect(main.map((c) => c.participantId)).toEqual(['carol']);
      expect(archived).toEqual([]);
    });

    it('asks for nothing more when the user has no messages', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      expect(await service.getConversations('alice')).toEqual([]);
      expect(userTable.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getMessagesWith', () => {
    it('returns the newest page, oldest message first', async () => {
      messageTable.findMany.mockResolvedValue([
        { id: 'newest' },
        { id: 'middle' },
        { id: 'oldest' },
      ]);

      const page = await service.getMessagesWith('alice', 'bob', 3);

      expect(page.map((m) => m.id)).toEqual(['oldest', 'middle', 'newest']);
      expect(messageTable.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
    });

    it('shows nothing of a conversation with a deactivated account', async () => {
      userTable.findFirst.mockResolvedValue(null);

      expect(await service.getMessagesWith('alice', 'bob', 50)).toEqual([]);
      expect(messageTable.findMany).not.toHaveBeenCalled();
    });

    it('only reads the conversation between the two users', async () => {
      messageTable.findMany.mockResolvedValue([]);

      await service.getMessagesWith('alice', 'bob', 50, '2026-01-01T00:00:00Z');

      expect(messageTable.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { senderId: 'alice', recipientId: 'bob' },
          { senderId: 'bob', recipientId: 'alice' },
        ],
        hiddenBy: { none: { userId: 'alice' } },
        createdAt: { lt: new Date('2026-01-01T00:00:00Z') },
      });
    });

    it('hides the messages from before a delete for me', async () => {
      messageTable.findMany.mockResolvedValue([]);
      states.clearedAt.mockResolvedValue(new Date('2026-01-05T00:00:00Z'));

      await service.getMessagesWith('alice', 'bob', 50);

      expect(messageTable.findMany.mock.calls[0][0].where.createdAt).toEqual({
        gt: new Date('2026-01-05T00:00:00Z'),
      });
    });

    describe('replies', () => {
      const quoted = {
        id: 'q-1',
        senderId: 'bob',
        recipientId: 'alice',
        ciphertext: 'quoted-cipher',
        nonce: 'quoted-nonce',
        createdAt: new Date('2026-01-03T00:00:00Z'),
        editedAt: null,
      };

      it('carries the quoted message, still encrypted', async () => {
        messageTable.findMany.mockResolvedValue([
          { id: 'm-2', replyToId: 'q-1', replyTo: { ...quoted, hiddenBy: [] } },
        ]);

        const [message] = await service.getMessagesWith('alice', 'bob', 50);

        expect(message).toEqual({ id: 'm-2', replyTo: quoted });
        expect(
          messageTable.findMany.mock.calls[0][0].include.replyTo.select
            .hiddenBy,
        ).toEqual({
          where: { userId: 'alice' },
          select: { userId: true },
        });
      });

      it('does not quote a message the reader deleted for themselves', async () => {
        messageTable.findMany.mockResolvedValue([
          {
            id: 'm-2',
            replyToId: 'q-1',
            replyTo: { ...quoted, hiddenBy: [{ userId: 'alice' }] },
          },
        ]);

        const [message] = await service.getMessagesWith('alice', 'bob', 50);

        expect(message.replyTo).toBeNull();
      });

      it('does not quote a message from before the reader deleted the chat for themselves', async () => {
        states.clearedAt.mockResolvedValue(new Date('2026-01-04T00:00:00Z'));
        messageTable.findMany.mockResolvedValue([
          { id: 'm-2', replyToId: 'q-1', replyTo: { ...quoted, hiddenBy: [] } },
        ]);

        const [message] = await service.getMessagesWith('alice', 'bob', 50);

        expect(message.replyTo).toBeNull();
      });
    });
  });

  describe('sending a reply', () => {
    it('links a reply to a message of the same conversation', async () => {
      messageTable.findFirst.mockResolvedValue({ id: 'q-1' });

      await service.sendMessage('alice', { ...newMessage, replyToId: 'q-1' });

      expect(messageTable.findFirst.mock.calls[0][0].where).toEqual({
        id: 'q-1',
        OR: [
          { senderId: 'alice', recipientId: 'bob' },
          { senderId: 'bob', recipientId: 'alice' },
        ],
      });
      expect(messageTable.create.mock.calls[0][0].data.replyToId).toBe('q-1');
    });

    it('sends a reply to a deleted message, or one from another chat, as an ordinary message', async () => {
      messageTable.findFirst.mockResolvedValue(null);

      await service.sendMessage('alice', {
        ...newMessage,
        replyToId: 'elsewhere',
      });

      expect(messageTable.create.mock.calls[0][0].data.replyToId).toBeNull();
    });

    it('returns the quoted message with the reply', async () => {
      messageTable.findFirst.mockResolvedValue({ id: 'q-1' });
      const quoted = {
        id: 'q-1',
        senderId: 'bob',
        ciphertext: 'q',
        nonce: 'n',
        hiddenBy: [],
      };
      messageTable.create.mockResolvedValue({
        ...stored,
        replyToId: 'q-1',
        replyTo: quoted,
      });

      const sent = await service.sendMessage('alice', {
        ...newMessage,
        replyToId: 'q-1',
      });

      expect(sent.replyTo).toEqual({
        id: 'q-1',
        senderId: 'bob',
        ciphertext: 'q',
        nonce: 'n',
      });
      expect(sent).not.toHaveProperty('replyToId');
    });

    it('needs no lookup for an ordinary message', async () => {
      await service.sendMessage('alice', newMessage);

      expect(messageTable.findFirst).not.toHaveBeenCalled();
      expect(messageTable.create.mock.calls[0][0].data.replyToId).toBeNull();
    });
  });
});
