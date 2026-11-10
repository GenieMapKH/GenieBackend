import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { RateLimit, RateLimits } from '@tilomnov/shared';
import { parsePayload } from '../chat/socket-payload';
import { userRoom } from '../chat/socket-rooms';
import { socketUser } from '../chat/ws-auth';
import { WsJwtGuard } from '../chat/ws-jwt.guard';
import { CallEndReason, LiveCall } from './call.types';
import { CallsService } from './calls.service';
import { CallInviteDto, CallRefDto, CallSignalDto } from './dto/call.dto';

type Ack = { status: 'ok' } | { status: 'error'; reason: string };

const OK: Ack = { status: 'ok' };
const INVALID: Ack = { status: 'error', reason: 'invalid' };

/**
 * Calls over the chat connection (same namespace, same sign-in). Events:
 *
 * - from the app: `call:invite`, `call:accept`, `call:decline`,
 *   `call:hangup`, `call:signal`
 * - to the app: `call:incoming` (all the callee's devices), `call:accepted`
 *   (the caller), `call:answered-elsewhere` (the callee's other devices),
 *   `call:ended` (both), `call:signal` (the other party)
 */
@WebSocketGateway({ cors: { origin: false }, namespace: '/chat' })
export class CallsGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Namespace;

  private readonly logger = new Logger(CallsGateway.name);

  /** Ten calls a minute is plenty for a person; more is someone being pestered. */
  private readonly inviteLimiter: RateLimit;

  constructor(
    private readonly calls: CallsService,
    rateLimits: RateLimits,
  ) {
    this.inviteLimiter = rateLimits.create('call-invite', 10, 60);
  }

  afterInit() {
    this.calls.onEnded((call, reason) => this.announceEnded(call, reason));
  }

  handleDisconnect(client: Socket) {
    this.calls
      .socketGone(client.id)
      .catch((error: Error) =>
        this.logger.error(
          `Call of a closed connection not ended: ${error.message}`,
        ),
      );
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:invite')
  async invite(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const dto = parsePayload(CallInviteDto, payload);
    if (!dto) return INVALID;
    const callerId = socketUser(client).userId;

    try {
      await this.inviteLimiter.consume(callerId);
    } catch {
      return { status: 'error', reason: 'too-many' };
    }

    return this.guarded('invite', async () => {
      const result = await this.calls.invite(
        callerId,
        client.id,
        dto.callId,
        dto.calleeId,
      );
      if (!result.ok) return { status: 'error', reason: result.reason };
      const { call } = result;
      this.server.to(userRoom(call.calleeId)).emit('call:incoming', {
        callId: call.id,
        callerId: call.callerId,
        callerName: call.callerName,
      });
      return OK;
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:accept')
  accept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const dto = parsePayload(CallRefDto, payload);
    if (!dto) return Promise.resolve(INVALID);

    return this.guarded('accept', async () => {
      const call = await this.calls.accept(
        socketUser(client).userId,
        client.id,
        dto.callId,
      );
      if (!call) return { status: 'error', reason: 'gone' };
      this.server
        .to(call.callerSocketId)
        .emit('call:accepted', { callId: call.id });
      // The callee's other devices stop ringing; this one is excluded.
      client
        .to(userRoom(call.calleeId))
        .emit('call:answered-elsewhere', { callId: call.id });
      return OK;
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:decline')
  decline(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const dto = parsePayload(CallRefDto, payload);
    if (!dto) return Promise.resolve(INVALID);
    return this.guarded('decline', async () => {
      await this.calls.decline(socketUser(client).userId, dto.callId);
      return OK;
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:hangup')
  hangUp(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const dto = parsePayload(CallRefDto, payload);
    if (!dto) return Promise.resolve(INVALID);
    return this.guarded('hang up', async () => {
      await this.calls.hangUp(socketUser(client).userId, dto.callId);
      return OK;
    });
  }

  /** Passed on to the other party only; dropped for anyone not in the call. */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:signal')
  signal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const dto = parsePayload(CallSignalDto, payload);
    if (!dto) return Promise.resolve(INVALID);

    return this.guarded('signal', async () => {
      const peer = await this.calls.peerSocket(
        socketUser(client).userId,
        client.id,
        dto.callId,
      );
      if (!peer) return { status: 'error', reason: 'gone' };
      this.server.to(peer).emit('call:signal', dto);
      return OK;
    });
  }

  /** Both parties hear it; the callee on every device, which may still be ringing. */
  private announceEnded(call: LiveCall, reason: CallEndReason): void {
    const ended = { callId: call.id, reason };
    this.server
      .to(call.callerSocketId)
      .to(userRoom(call.calleeId))
      .emit('call:ended', ended);
  }

  /** A failure is reported to the app, never thrown into the socket. */
  private async guarded(action: string, run: () => Promise<Ack>): Promise<Ack> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(`Call ${action} failed: ${(error as Error).message}`);
      return { status: 'error', reason: 'failed' };
    }
  }
}
