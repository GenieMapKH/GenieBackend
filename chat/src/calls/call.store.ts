import { Injectable } from '@nestjs/common';
import { RedisConnection } from '@tilomnov/shared';
import { LiveCall } from './call.types';

/**
 * Calls in progress. Kept outside any one instance, so a call can ring on
 * one instance of the service and be answered on another.
 */
export abstract class CallStore {
  /** Saves a new call and marks both people busy. False when either is already in a call. */
  abstract start(call: LiveCall, ttlSeconds: number): Promise<boolean>;

  abstract get(callId: string): Promise<LiveCall | null>;

  /** Saves a change (answered), binding both parties' sockets to the call. */
  abstract update(call: LiveCall, ttlSeconds: number): Promise<void>;

  /** The call a socket takes part in, if any. */
  abstract callOfSocket(socketId: string): Promise<string | null>;

  /**
   * Removes the call. True only for the one caller that removed it, so a
   * hang-up and a ring timeout at the same moment end it once.
   */
  abstract finish(call: LiveCall): Promise<boolean>;
}

/** Deletes a key only while it still names this call, never a newer one's. */
const DELETE_IF_EQUAL = `
  if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
  return 0`;

const callKey = (callId: string) => `call:${callId}`;
const busyKey = (userId: string) => `call:busy:${userId}`;
const socketKey = (socketId: string) => `call:socket:${socketId}`;

@Injectable()
export class RedisCallStore extends CallStore {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  private get redis() {
    return this.connection.client;
  }

  async start(call: LiveCall, ttlSeconds: number): Promise<boolean> {
    if (
      !(await this.redis.set(
        busyKey(call.callerId),
        call.id,
        'EX',
        ttlSeconds,
        'NX',
      ))
    )
      return false;
    if (
      !(await this.redis.set(
        busyKey(call.calleeId),
        call.id,
        'EX',
        ttlSeconds,
        'NX',
      ))
    ) {
      await this.deleteIfEqual(busyKey(call.callerId), call.id);
      return false;
    }
    await this.redis
      .multi()
      .set(callKey(call.id), JSON.stringify(call), 'EX', ttlSeconds)
      .set(socketKey(call.callerSocketId), call.id, 'EX', ttlSeconds)
      .exec();
    return true;
  }

  async get(callId: string): Promise<LiveCall | null> {
    const json = await this.redis.get(callKey(callId));
    return json ? (JSON.parse(json) as LiveCall) : null;
  }

  async update(call: LiveCall, ttlSeconds: number): Promise<void> {
    const write = this.redis
      .multi()
      .set(callKey(call.id), JSON.stringify(call), 'EX', ttlSeconds, 'XX')
      .expire(busyKey(call.callerId), ttlSeconds)
      .expire(busyKey(call.calleeId), ttlSeconds)
      .set(socketKey(call.callerSocketId), call.id, 'EX', ttlSeconds);
    if (call.calleeSocketId)
      write.set(socketKey(call.calleeSocketId), call.id, 'EX', ttlSeconds);
    await write.exec();
  }

  callOfSocket(socketId: string): Promise<string | null> {
    return this.redis.get(socketKey(socketId));
  }

  async finish(call: LiveCall): Promise<boolean> {
    if ((await this.redis.del(callKey(call.id))) === 0) return false;
    await Promise.all([
      this.deleteIfEqual(busyKey(call.callerId), call.id),
      this.deleteIfEqual(busyKey(call.calleeId), call.id),
      this.deleteIfEqual(socketKey(call.callerSocketId), call.id),
      ...(call.calleeSocketId
        ? [this.deleteIfEqual(socketKey(call.calleeSocketId), call.id)]
        : []),
    ]);
    return true;
  }

  private deleteIfEqual(key: string, value: string): Promise<unknown> {
    return this.redis.eval(DELETE_IF_EQUAL, 1, key, value);
  }
}
