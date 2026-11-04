import { HttpException, Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { RateLimit, RateLimits, RevokedSessions } from '@tilomnov/shared';
import { BlockChecker, BlockedException } from './block-checker';
import { ChatService } from './chat.service';
import { PresenceTargetDto, SendMessageDto } from './dto/chat.dto';
import { PresenceService } from './presence.service';
import { parsePayload } from './socket-payload';
import { userRoom } from './socket-rooms';
import { refuseApiVersion } from './ws-api-version';
import { authenticateSocket, SocketUser, socketUser } from './ws-auth';
import { WsJwtGuard } from './ws-jwt.guard';

/** The connections of one signed-in device, so they can be closed when it is signed out. */
function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Sockets that want to know when this user comes online or goes offline. */
function presenceRoom(userId: string): string {
  return `presence:${userId}`;
}

/** Asking the other instances must never hold up a connection for long. */
const PRESENCE_TIMEOUT_MS = 1000;

/**
 * Real-time delivery of end-to-end encrypted messages, and who is online.
 * The server only stores and forwards ciphertext; it cannot read messages.
 */
// Mobile clients do not use CORS, so no browser origin is allowed.
@WebSocketGateway({ cors: { origin: false }, namespace: '/chat' })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server: Namespace;

  private readonly logger = new Logger(ChatGateway.name);

  /** Stops one account from flooding others: 30 messages per 10 seconds. */
  private readonly sendRateLimiter: RateLimit;

  constructor(
    private readonly chatService: ChatService,
    private readonly presenceService: PresenceService,
    private readonly revokedSessions: RevokedSessions,
    rateLimits: RateLimits,
    private readonly blocks: BlockChecker,
  ) {
    this.sendRateLimiter = rateLimits.create('chat-send', 30, 10);
  }

  /**
   * Rejects the handshake itself, so an unauthenticated socket, or one of an
   * API version this server does not speak, never connects.
   */
  afterInit(server: Namespace) {
    server.use((client, next) => {
      const versionRefusal = refuseApiVersion(client);
      if (versionRefusal) {
        this.logger.warn(`Connection rejected: ${versionRefusal}`);
        next(new Error(versionRefusal));
        return;
      }
      authenticateSocket(client, this.revokedSessions).then(
        () => next(),
        (error: Error) => {
          this.logger.warn(`Connection rejected: ${error.message}`);
          next(new Error('unauthorized'));
        },
      );
    });

    // A device that is signed out stops receiving messages at once, not when
    // its token expires. Every instance hears this and closes its own sockets.
    this.revokedSessions.onRevoked((sessionId) => {
      server.local.in(sessionRoom(sessionId)).disconnectSockets(true);
    });
  }

  async handleConnection(client: Socket) {
    const { userId } = socketUser(client);
    const sessionId = socketUser(client).sessionId ?? null;
    // Joined first: receiving messages must not wait for the presence check below.
    await client.join(
      sessionId ? [userRoom(userId), sessionRoom(sessionId)] : userRoom(userId),
    );
    const cameOnline = (await this.connectedDevices(userId)) <= 1;

    this.logger.log(`Connected: user ${userId} (socket ${client.id})`);
    if (cameOnline) {
      this.server
        .to(presenceRoom(userId))
        .emit('presence', { userId, online: true, lastSeenAt: null });
    }
  }

  /** The user is offline once their last device has disconnected. */
  async handleDisconnect(client: Socket) {
    const { userId } = client.data as Partial<SocketUser>;
    if (!userId) return;
    this.logger.log(`Disconnected: user ${userId} (socket ${client.id})`);
    if ((await this.connectedDevices(userId)) > 0) return;

    try {
      const lastSeenAt = await this.presenceService.markLastSeen(userId);
      this.server
        .to(presenceRoom(userId))
        .emit('presence', { userId, online: false, lastSeenAt });
    } catch (error) {
      this.logger.error(
        `Failed to record last seen: ${(error as Error).message}`,
      );
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const senderId = socketUser(client).userId;

    const dto = parsePayload(SendMessageDto, payload);
    if (!dto) {
      return { status: 'error', message: 'Invalid message' };
    }

    try {
      await this.sendRateLimiter.consume(senderId);
    } catch {
      return {
        status: 'error',
        message: 'You are sending messages too quickly. Wait a moment.',
      };
    }

    try {
      const message = await this.chatService.sendMessage(senderId, dto);

      // The recipient's devices, plus the sender's other devices.
      client
        .to(userRoom(message.recipientId))
        .to(userRoom(senderId))
        .emit('newMessage', message);

      return { status: 'ok', messageId: message.id, message };
    } catch (error) {
      if (error instanceof BlockedException) {
        return { status: 'error', message: error.message, code: error.code };
      }
      if (error instanceof HttpException) {
        return { status: 'error', message: error.message };
      }
      this.logger.error(`Failed to send message: ${(error as Error).message}`);
      return { status: 'error', message: 'Failed to process message' };
    }
  }

  /**
   * Replies with the user's current presence and keeps this socket updated.
   * Between two people where either blocked the other, the user just looks
   * offline with no last seen, as a hidden one does: the block is not told.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('watchPresence')
  async handleWatchPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const dto = parsePayload(PresenceTargetDto, payload);
    if (!dto) {
      return { status: 'error', message: 'Invalid user' };
    }
    if (
      await this.blocks.eitherBlocked(socketUser(client).userId, dto.userId)
    ) {
      return {
        status: 'ok',
        presence: { userId: dto.userId, online: false, lastSeenAt: null },
      };
    }

    await client.join(presenceRoom(dto.userId));
    const online = (await this.connectedDevices(dto.userId)) > 0;
    return {
      status: 'ok',
      presence: {
        userId: dto.userId,
        online,
        lastSeenAt: await this.lastSeenOf(dto.userId, online),
      },
    };
  }

  /** Online status is still worth showing when "last seen" cannot be read. */
  private async lastSeenOf(
    userId: string,
    online: boolean,
  ): Promise<Date | null> {
    if (online) return null;
    try {
      return await this.presenceService.getLastSeen(userId);
    } catch (error) {
      this.logger.error(
        `Failed to read last seen: ${(error as Error).message}`,
      );
      return null;
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('unwatchPresence')
  async handleUnwatchPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const dto = parsePayload(PresenceTargetDto, payload);
    if (dto) {
      await client.leave(presenceRoom(dto.userId));
    }
    return { status: 'ok' };
  }

  /**
   * Tells [userId]'s devices that their conversation with [partnerId] was
   * archived, restored or deleted, so every device shows the same list. With
   * [forPartner] (deleted for everyone), the partner's devices are told too.
   */
  notifyConversationChanged(
    userId: string,
    partnerId: string,
    change: { historyCleared: boolean; forPartner?: boolean },
  ) {
    const { historyCleared, forPartner = false } = change;
    this.server.to(userRoom(userId)).emit('conversationChanged', {
      participantId: partnerId,
      historyCleared,
    });
    if (forPartner) {
      this.server
        .to(userRoom(partnerId))
        .emit('conversationChanged', { participantId: userId, historyCleared });
    }
  }

  /**
   * One of the two blocked the other: neither hears the other come online or
   * go offline any more, on any instance, from presence watched before.
   */
  separatePresence(userId: string, otherId: string) {
    this.server.in(userRoom(userId)).socketsLeave(presenceRoom(otherId));
    this.server.in(userRoom(otherId)).socketsLeave(presenceRoom(userId));
  }

  /** Both people's devices replace the text of an edited message. */
  notifyMessageEdited(message: { senderId: string; recipientId: string }) {
    this.server
      .to([userRoom(message.senderId), userRoom(message.recipientId)])
      .emit('messageEdited', message);
  }

  /**
   * [userId]'s devices drop a message they deleted; with [forEveryone] the
   * other person's devices drop it too. `participantId` is the other person
   * in the conversation, as seen by whoever receives the event.
   */
  notifyMessageDeleted(
    userId: string,
    messageId: string,
    change: { senderId: string; recipientId: string; forEveryone: boolean },
  ) {
    const partnerId =
      change.senderId === userId ? change.recipientId : change.senderId;
    this.server
      .to(userRoom(userId))
      .emit('messageDeleted', { messageId, participantId: partnerId });
    if (change.forEveryone) {
      this.server
        .to(userRoom(partnerId))
        .emit('messageDeleted', { messageId, participantId: userId });
    }
  }

  /** How many devices the user has connected, counted across every instance of this service. */
  private async connectedDevices(userId: string): Promise<number> {
    let timer: NodeJS.Timeout | undefined;
    const tooSlow = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('no answer from the other instances')),
        PRESENCE_TIMEOUT_MS,
      );
    });
    try {
      return (
        await Promise.race([
          this.server.in(userRoom(userId)).fetchSockets(),
          tooSlow,
        ])
      ).length;
    } catch (error) {
      // Redis could not relay the question: count the devices on this instance.
      this.logger.warn(
        `Presence counted on this instance only: ${(error as Error).message}`,
      );
      return this.server.adapter.rooms.get(userRoom(userId))?.size ?? 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
