import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { BlockChecker } from '../chat/block-checker';
import { DISPLAY_FIELDS, displayName } from '../chat/display-name';
import { NotificationClient } from '../chat/notification.client';
import { CallStore } from './call.store';
import { CallEndReason, LiveCall } from './call.types';

/** A call nobody answers stops ringing after this long and counts as missed. */
export const RING_SECONDS = 45;
/** Ringing state is kept a little longer than the ring itself. */
const RINGING_TTL_SECONDS = RING_SECONDS + 15;
/** The longest a call is kept; a forgotten one cannot keep anyone busy for ever. */
const ACTIVE_TTL_SECONDS = 4 * 60 * 60;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export type InviteResult =
  | { ok: true; call: LiveCall }
  | { ok: false; reason: 'self' | 'unavailable' | 'busy' | 'invalid' };

type EndedListener = (call: LiveCall, reason: CallEndReason) => void;

/**
 * The rules of a one-to-one voice call: who may call whom, one call per
 * person at a time, ringing that stops when nobody answers, and a record of
 * every call. Audio never passes through the server: it only introduces the
 * two phones to each other (see `CallsGateway`).
 */
@Injectable()
export class CallsService implements OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  private readonly endedListeners: EndedListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CallStore,
    private readonly notifications: NotificationClient,
    private readonly blocks: BlockChecker,
  ) {}

  /** Called with every call that ends, however it ends, once. */
  onEnded(listener: EndedListener): void {
    this.endedListeners.push(listener);
  }

  /** [callerId] calls [calleeId] from the connection [callerSocketId]. */
  async invite(
    callerId: string,
    callerSocketId: string,
    callId: string,
    calleeId: string,
  ): Promise<InviteResult> {
    if (callerId === calleeId) return { ok: false, reason: 'self' };

    const [caller, callee, blocked] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: callerId, deactivatedAt: null },
        select: DISPLAY_FIELDS,
      }),
      this.prisma.user.findFirst({
        where: { id: calleeId, deactivatedAt: null },
        select: { id: true },
      }),
      this.blocks.eitherBlocked(callerId, calleeId),
    ]);
    // A block looks like nobody answering: the caller is not told about it.
    if (!caller || !callee || blocked) {
      return { ok: false, reason: 'unavailable' };
    }

    const call: LiveCall = {
      id: callId,
      callerId,
      calleeId,
      callerName: displayName(caller),
      callerSocketId,
      calleeSocketId: null,
      status: 'ringing',
      createdAt: new Date().toISOString(),
      answeredAt: null,
    };
    // Claimed first, so only calls that really ring are recorded.
    if (!(await this.store.start(call, RINGING_TTL_SECONDS)))
      return { ok: false, reason: 'busy' };
    try {
      await this.prisma.callLog.create({
        data: { id: callId, callerId, calleeId },
      });
    } catch (error) {
      await this.store.finish(call);
      if ((error as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION)
        return { ok: false, reason: 'invalid' };
      throw error;
    }

    this.notifications.callRinging(this.notice(call));
    this.ringTimers.set(
      callId,
      setTimeout(() => void this.ringTimedOut(callId), RING_SECONDS * 1000),
    );
    return { ok: true, call };
  }

  /** The callee answered on [socketId]. Null when the call is no longer theirs to answer. */
  async accept(
    calleeId: string,
    socketId: string,
    callId: string,
  ): Promise<LiveCall | null> {
    const call = await this.store.get(callId);
    if (!call || call.calleeId !== calleeId || call.status !== 'ringing')
      return null;

    const answered: LiveCall = {
      ...call,
      status: 'active',
      calleeSocketId: socketId,
      answeredAt: new Date().toISOString(),
    };
    await this.store.update(answered, ACTIVE_TTL_SECONDS);
    this.clearRing(callId);
    await this.prisma.callLog
      .update({
        where: { id: callId },
        data: { status: 'active', answeredAt: new Date(answered.answeredAt!) },
      })
      .catch((error: Error) =>
        this.logger.error(
          `Call ${callId} answer not recorded: ${error.message}`,
        ),
      );
    // The callee's other phones stop ringing.
    this.notifications.callEnded({ ...this.notice(call), missed: false });
    return answered;
  }

  /** The callee turned the call down. */
  async decline(calleeId: string, callId: string): Promise<boolean> {
    const call = await this.store.get(callId);
    if (!call || call.calleeId !== calleeId || call.status !== 'ringing')
      return false;
    return this.end(call, 'declined');
  }

  /** Either person hangs up; before an answer, the caller cancels it. */
  async hangUp(userId: string, callId: string): Promise<boolean> {
    const call = await this.store.get(callId);
    if (!call || (call.callerId !== userId && call.calleeId !== userId))
      return false;
    if (call.status === 'active') return this.end(call, 'ended');
    return this.end(call, userId === call.callerId ? 'cancelled' : 'declined');
  }

  /** A connection closed: a call it took part in cannot go on. */
  async socketGone(socketId: string): Promise<void> {
    const callId = await this.store.callOfSocket(socketId);
    const call = callId ? await this.store.get(callId) : null;
    if (!call) return;
    // A callee's other devices may still answer while the call rings.
    if (call.status === 'ringing' && call.callerSocketId !== socketId) return;
    await this.end(
      call,
      call.status === 'ringing' ? 'cancelled' : 'disconnected',
    );
  }

  /**
   * Where a signal from [socketId] goes: the other party's connection, once
   * the call is answered. Null for anyone else, so nobody can eavesdrop on
   * or meddle with someone else's call.
   */
  async peerSocket(
    userId: string,
    socketId: string,
    callId: string,
  ): Promise<string | null> {
    const call = await this.store.get(callId);
    if (!call || call.status !== 'active' || !call.calleeSocketId) return null;
    if (call.callerId === userId && call.callerSocketId === socketId)
      return call.calleeSocketId;
    if (call.calleeId === userId && call.calleeSocketId === socketId)
      return call.callerSocketId;
    return null;
  }

  onModuleDestroy() {
    for (const timer of this.ringTimers.values()) clearTimeout(timer);
    this.ringTimers.clear();
  }

  private async ringTimedOut(callId: string): Promise<void> {
    this.ringTimers.delete(callId);
    try {
      const call = await this.store.get(callId);
      if (call?.status === 'ringing') await this.end(call, 'missed');
    } catch (error) {
      this.logger.error(
        `Call ${callId} did not stop ringing: ${(error as Error).message}`,
      );
    }
  }

  private async end(call: LiveCall, reason: CallEndReason): Promise<boolean> {
    if (!(await this.store.finish(call))) return false;
    this.clearRing(call.id);
    await this.recordEnd(call.id, reason);

    if (call.status === 'ringing') {
      // Stops the callee's phones ringing; a call they never got to is missed.
      this.notifications.callEnded({
        ...this.notice(call),
        missed: reason === 'missed' || reason === 'cancelled',
      });
    }
    for (const listener of this.endedListeners) listener(call, reason);
    return true;
  }

  private async recordEnd(
    callId: string,
    reason: CallEndReason,
  ): Promise<void> {
    await this.prisma.callLog
      .update({
        where: { id: callId },
        data: { status: 'ended', endReason: reason, endedAt: new Date() },
      })
      .catch((error: Error) =>
        this.logger.error(`Call ${callId} end not recorded: ${error.message}`),
      );
  }

  private clearRing(callId: string): void {
    clearTimeout(this.ringTimers.get(callId));
    this.ringTimers.delete(callId);
  }

  private notice(call: LiveCall) {
    return {
      callId: call.id,
      callerId: call.callerId,
      callerName: call.callerName,
      calleeId: call.calleeId,
    };
  }
}
