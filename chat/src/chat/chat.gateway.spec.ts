import { NotFoundException } from '@nestjs/common';
import { memoryRateLimits } from '@tilomnov/shared/testing';
import { ChatGateway } from './chat.gateway';
import * as wsAuth from './ws-auth';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const LAST_SEEN = new Date('2026-01-01T10:00:00Z');

describe('ChatGateway', () => {
  const chatService = { sendMessage: jest.fn() };
  const presenceService = {
    markLastSeen: jest.fn(),
    getLastSeen: jest.fn(),
    isVisible: jest.fn(),
  };
  const blocks = { eitherBlocked: jest.fn() };
  let socketsLeft: [string, string][];
  /** Stands in for the list of signed-out sessions; `signOut` is what the gateway registered. */
  const revokedSessions = {
    has: jest.fn(),
    signOut: (_sessionId: string): void => undefined,
    onRevoked: (listener: (sessionId: string) => void) => {
      revokedSessions.signOut = listener;
    },
  };
  let gateway: ChatGateway;

  /** Room name -> socket ids, as socket.io tracks them. */
  let rooms: Map<string, Set<string>>;
  /** Everything the server broadcast: [room(s), event, payload]. */
  let broadcasts: [string | string[], string, unknown][];

  /** A connected socket; records which rooms a broadcast was sent to. */
  function socketFor(userId: string, id = `socket-${userId}`) {
    const sentTo: string[] = [];
    const joined = new Set<string>();
    const broadcast = {
      to: jest.fn((room: string) => {
        sentTo.push(room);
        return broadcast;
      }),
      emit: jest.fn(),
    };
    return {
      id,
      data: { userId },
      join: jest.fn((room: string) => {
        rooms.set(room, (rooms.get(room) ?? new Set()).add(id));
        joined.add(room);
      }),
      leave: jest.fn((room: string) => {
        rooms.get(room)?.delete(id);
        joined.delete(room);
      }),
      to: broadcast.to,
      emit: broadcast.emit,
      rooms: joined,
      broadcastRooms: sentTo,
    };
  }

  const payload = {
    id: MESSAGE_ID,
    recipientId: BOB,
    ciphertext: 'cipher',
    nonce: 'nonce',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rooms = new Map();
    broadcasts = [];
    chatService.sendMessage.mockImplementation(
      (senderId: string, message: typeof payload) =>
        Promise.resolve({ ...message, senderId }),
    );
    presenceService.markLastSeen.mockResolvedValue(LAST_SEEN);
    presenceService.getLastSeen.mockResolvedValue(LAST_SEEN);
    presenceService.isVisible.mockResolvedValue(true);

    revokedSessions.has.mockResolvedValue(false);
    blocks.eitherBlocked.mockResolvedValue(false);
    socketsLeft = [];

    gateway = new ChatGateway(
      chatService as never,
      presenceService as never,
      revokedSessions as never,
      memoryRateLimits,
      blocks as never,
    );
    (gateway as unknown as { server: unknown }).server = {
      adapter: { rooms },
      in: (room: string) => ({
        fetchSockets: () => Promise.resolve([...(rooms.get(room) ?? [])]),
        socketsLeave: (left: string) => socketsLeft.push([room, left]),
      }),
      to: (room: string | string[]) => ({
        emit: (event: string, data: unknown) =>
          broadcasts.push([room, event, data]),
      }),
    };
  });

  it('rejects nonexistent targets and caps presence subscriptions', async () => {
    const client = socketFor(ALICE);
    presenceService.isVisible.mockResolvedValueOnce(false);
    expect(
      await gateway.handleWatchPresence(client as never, { userId: BOB }),
    ).toMatchObject({ status: 'error' });
    expect(client.join).not.toHaveBeenCalled();
    for (let n = 0; n < 103; n++) client.rooms.add(`room-${n}`);
    expect(
      await gateway.handleWatchPresence(client as never, { userId: BOB }),
    ).toMatchObject({ status: 'error' });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('rate limits presence events per account', async () => {
    const client = socketFor(ALICE);
    for (let n = 0; n < 60; n++)
      await gateway.handleWatchPresence(client as never, { userId: BOB });
    expect(
      await gateway.handleWatchPresence(client as never, { userId: BOB }),
    ).toMatchObject({ status: 'error' });
    expect(presenceService.isVisible).toHaveBeenCalledTimes(60);
  });

  describe('handshake', () => {
    async function runHandshake(token: string | undefined) {
      let middleware: (
        client: unknown,
        next: (error?: Error) => void,
      ) => Promise<void> = async () => undefined;
      gateway.afterInit({
        use: (fn: typeof middleware) => (middleware = fn),
      } as never);

      const client = {
        handshake: { headers: {}, auth: { token } },
        data: {} as { userId?: string },
      };
      const next = jest.fn();
      await middleware(client, next);
      return { client, next };
    }

    it('accepts a socket that authenticates', async () => {
      const authenticate = jest
        .spyOn(wsAuth, 'authenticateSocket')
        .mockResolvedValue({
          userId: ALICE,
          sessionId: 'phone',
          expiresAt: Date.now() + 60000,
        });

      const { client, next } = await runHandshake('good-token');

      expect(next).toHaveBeenCalledWith();
      // Asked with the list of signed-out sessions, so such a device is turned away here.
      expect(authenticate).toHaveBeenCalledWith(client, revokedSessions);
    });

    it('rejects one that does not: no token, an expired one, a signed-out device', async () => {
      jest
        .spyOn(wsAuth, 'authenticateSocket')
        .mockRejectedValue(new Error('This device was signed out'));

      expect((await runHandshake('good-token')).next.mock.calls[0][0]).toEqual(
        new Error('unauthorized'),
      );
    });
  });

  it("puts each connection in its user's room", async () => {
    const client = socketFor(ALICE);

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith(`user:${ALICE}`);
  });

  it('closes the connections of a device the moment it is signed out, and only those', async () => {
    const closed: string[] = [];
    gateway.afterInit({
      use: () => undefined,
      local: {
        in: (room: string) => ({ disconnectSockets: () => closed.push(room) }),
      },
    } as never);
    const phone = {
      ...socketFor(ALICE, 'phone'),
      data: { userId: ALICE, sessionId: 'session-phone' },
    };
    await gateway.handleConnection(phone as never);
    expect(phone.join).toHaveBeenCalledWith([
      `user:${ALICE}`,
      'session:session-phone',
    ]);

    revokedSessions.signOut('session-phone');

    expect(closed).toEqual(['session:session-phone']);
  });

  describe('presence', () => {
    it('announces a user coming online once, not once per device', async () => {
      await gateway.handleConnection(socketFor(ALICE, 'phone') as never);
      await gateway.handleConnection(socketFor(ALICE, 'tablet') as never);

      expect(broadcasts).toEqual([
        [
          `presence:${ALICE}`,
          'presence',
          { userId: ALICE, online: true, lastSeenAt: null },
        ],
      ]);
    });

    it('keeps a user online while another of their devices is connected', async () => {
      const phone = socketFor(ALICE, 'phone');
      await gateway.handleConnection(phone as never);
      await gateway.handleConnection(socketFor(ALICE, 'tablet') as never);
      broadcasts = [];

      phone.leave(`user:${ALICE}`);
      await gateway.handleDisconnect(phone as never);

      expect(presenceService.markLastSeen).not.toHaveBeenCalled();
      expect(broadcasts).toEqual([]);
    });

    it('records and announces last seen when the last device disconnects', async () => {
      const phone = socketFor(ALICE, 'phone');
      await gateway.handleConnection(phone as never);
      broadcasts = [];

      phone.leave(`user:${ALICE}`);
      await gateway.handleDisconnect(phone as never);

      expect(presenceService.markLastSeen).toHaveBeenCalledWith(ALICE);
      expect(broadcasts).toEqual([
        [
          `presence:${ALICE}`,
          'presence',
          { userId: ALICE, online: false, lastSeenAt: LAST_SEEN },
        ],
      ]);
    });

    it('survives a database error while recording last seen', async () => {
      presenceService.markLastSeen.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        gateway.handleDisconnect(socketFor(ALICE) as never),
      ).resolves.toBeUndefined();
    });

    it('tells a watcher that the user is online', async () => {
      await gateway.handleConnection(socketFor(BOB) as never);
      const watcher = socketFor(ALICE);

      const ack = await gateway.handleWatchPresence(watcher as never, {
        userId: BOB,
      });

      expect(watcher.join).toHaveBeenCalledWith(`presence:${BOB}`);
      expect(ack).toEqual({
        status: 'ok',
        presence: { userId: BOB, online: true, lastSeenAt: null },
      });
      expect(presenceService.getLastSeen).not.toHaveBeenCalled();
    });

    it('shows someone blocked either way as offline, and never updates the watcher', async () => {
      await gateway.handleConnection(socketFor(BOB) as never);
      blocks.eitherBlocked.mockResolvedValue(true);
      const watcher = socketFor(ALICE);

      const ack = await gateway.handleWatchPresence(watcher as never, {
        userId: BOB,
      });

      expect(blocks.eitherBlocked).toHaveBeenCalledWith(ALICE, BOB);
      expect(watcher.join).not.toHaveBeenCalledWith(`presence:${BOB}`);
      expect(ack).toEqual({
        status: 'ok',
        presence: { userId: BOB, online: false, lastSeenAt: null },
      });
      expect(presenceService.getLastSeen).not.toHaveBeenCalled();
    });

    it('stops presence watched before a block, both ways', () => {
      gateway.separatePresence(ALICE, BOB);

      expect(socketsLeft).toEqual([
        [`user:${ALICE}`, `presence:${BOB}`],
        [`user:${BOB}`, `presence:${ALICE}`],
      ]);
    });

    it('tells a watcher when an offline user was last seen', async () => {
      const ack = await gateway.handleWatchPresence(socketFor(ALICE) as never, {
        userId: BOB,
      });

      expect(ack).toEqual({
        status: 'ok',
        presence: { userId: BOB, online: false, lastSeenAt: LAST_SEEN },
      });
    });

    it('still answers when last seen cannot be read', async () => {
      presenceService.getLastSeen.mockRejectedValue(
        new Error('column does not exist'),
      );

      const ack = await gateway.handleWatchPresence(socketFor(ALICE) as never, {
        userId: BOB,
      });

      expect(ack).toEqual({
        status: 'ok',
        presence: { userId: BOB, online: false, lastSeenAt: null },
      });
    });

    it('rejects a watch request without a valid user id', async () => {
      const watcher = socketFor(ALICE);

      const ack = await gateway.handleWatchPresence(watcher as never, {
        userId: 'everyone',
      });

      expect(ack).toEqual({ status: 'error', message: 'Invalid user' });
      expect(watcher.join).not.toHaveBeenCalled();
    });

    it('stops updates when a watcher leaves', async () => {
      const watcher = socketFor(ALICE);
      await gateway.handleWatchPresence(watcher as never, { userId: BOB });

      await gateway.handleUnwatchPresence(watcher as never, { userId: BOB });

      expect(watcher.leave).toHaveBeenCalledWith(`presence:${BOB}`);
    });
  });

  describe('sendMessage', () => {
    it('stores the message and delivers it to both users, but not back to this socket', async () => {
      const client = socketFor(ALICE);

      const ack = await gateway.handleSendMessage(client as never, payload);

      expect(chatService.sendMessage).toHaveBeenCalledWith(ALICE, payload);
      expect(client.broadcastRooms).toEqual([`user:${BOB}`, `user:${ALICE}`]);
      expect(client.emit).toHaveBeenCalledWith(
        'newMessage',
        expect.objectContaining({ id: MESSAGE_ID }),
      );
      expect(ack).toMatchObject({ status: 'ok', messageId: MESSAGE_ID });
    });

    it('passes on which message a reply quotes', async () => {
      const client = socketFor(ALICE);

      await gateway.handleSendMessage(client as never, {
        ...payload,
        replyToId: OTHER_MESSAGE_ID,
      });

      expect(chatService.sendMessage.mock.calls[0][1]).toMatchObject({
        replyToId: OTHER_MESSAGE_ID,
      });
    });

    it('takes the sender from the socket, never from the payload', async () => {
      const client = socketFor(ALICE);

      await gateway.handleSendMessage(client as never, {
        ...payload,
        senderId: BOB,
      });

      const [senderId, message] = chatService.sendMessage.mock.calls[0];
      expect(senderId).toBe(ALICE);
      expect(message).not.toHaveProperty('senderId');
    });

    it.each([
      ['no payload', undefined],
      ['a non-object payload', 'hello'],
      ['a recipient that is not a UUID', { ...payload, recipientId: 'bob' }],
      ['an id that is not a UUID', { ...payload, id: 'abc' }],
      ['an empty ciphertext', { ...payload, ciphertext: '' }],
      [
        'an oversized ciphertext',
        { ...payload, ciphertext: 'a'.repeat(16385) },
      ],
      ['a missing nonce', { ...payload, nonce: undefined }],
    ])('rejects %s without storing it', async (_name, invalid) => {
      const client = socketFor(ALICE);

      const ack = await gateway.handleSendMessage(client as never, invalid);

      expect(ack).toEqual({ status: 'error', message: 'Invalid message' });
      expect(chatService.sendMessage).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('stops an account that floods messages, without affecting others', async () => {
      const flooder = socketFor(ALICE);
      for (let i = 0; i < 30; i++) {
        await gateway.handleSendMessage(flooder as never, payload);
      }

      const blocked = await gateway.handleSendMessage(
        flooder as never,
        payload,
      );
      const other = await gateway.handleSendMessage(socketFor(BOB) as never, {
        ...payload,
        recipientId: ALICE,
      });

      expect(blocked).toMatchObject({
        status: 'error',
        message: expect.stringContaining('too quickly'),
      });
      expect(chatService.sendMessage).toHaveBeenCalledTimes(31);
      expect(other).toMatchObject({ status: 'ok' });
    });

    it('reports a business error to the sender and delivers nothing', async () => {
      chatService.sendMessage.mockRejectedValue(
        new NotFoundException('Recipient not found'),
      );
      const client = socketFor(ALICE);

      const ack = await gateway.handleSendMessage(client as never, payload);

      expect(ack).toEqual({ status: 'error', message: 'Recipient not found' });
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('does not leak unexpected errors', async () => {
      chatService.sendMessage.mockRejectedValue(
        new Error('password authentication failed for user "postgres"'),
      );
      const client = socketFor(ALICE);

      const ack = await gateway.handleSendMessage(client as never, payload);

      expect(ack).toEqual({
        status: 'error',
        message: 'Failed to process message',
      });
    });
  });
  describe('message changes', () => {
    it("tells both people's devices about an edit", () => {
      const edited = {
        id: MESSAGE_ID,
        senderId: ALICE,
        recipientId: BOB,
        ciphertext: 'new',
      };

      gateway.notifyMessageEdited(edited);

      expect(broadcasts).toEqual([
        [[`user:${ALICE}`, `user:${BOB}`], 'messageEdited', edited],
      ]);
    });

    it("tells only the caller's devices about a delete for me", () => {
      gateway.notifyMessageDeleted(BOB, MESSAGE_ID, {
        senderId: ALICE,
        recipientId: BOB,
        forEveryone: false,
      });

      expect(broadcasts).toEqual([
        [
          `user:${BOB}`,
          'messageDeleted',
          { messageId: MESSAGE_ID, participantId: ALICE },
        ],
      ]);
    });

    it('tells both people about a delete for everyone, each naming the other person', () => {
      gateway.notifyMessageDeleted(ALICE, MESSAGE_ID, {
        senderId: ALICE,
        recipientId: BOB,
        forEveryone: true,
      });

      expect(broadcasts).toEqual([
        [
          `user:${ALICE}`,
          'messageDeleted',
          { messageId: MESSAGE_ID, participantId: BOB },
        ],
        [
          `user:${BOB}`,
          'messageDeleted',
          { messageId: MESSAGE_ID, participantId: ALICE },
        ],
      ]);
    });
  });
});
