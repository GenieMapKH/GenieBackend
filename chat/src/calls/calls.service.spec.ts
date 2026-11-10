import { CallStore } from './call.store';
import { CallEndReason, LiveCall } from './call.types';
import { CallsService, RING_SECONDS } from './calls.service';

/** The same rules as the Redis store, in memory. */
class MemoryCallStore extends CallStore {
  calls = new Map<string, LiveCall>();
  busy = new Map<string, string>();
  sockets = new Map<string, string>();

  start(call: LiveCall): Promise<boolean> {
    if (this.busy.has(call.callerId) || this.busy.has(call.calleeId))
      return Promise.resolve(false);
    this.busy.set(call.callerId, call.id).set(call.calleeId, call.id);
    this.calls.set(call.id, call);
    this.sockets.set(call.callerSocketId, call.id);
    return Promise.resolve(true);
  }

  get(callId: string): Promise<LiveCall | null> {
    return Promise.resolve(this.calls.get(callId) ?? null);
  }

  update(call: LiveCall): Promise<void> {
    this.calls.set(call.id, call);
    if (call.calleeSocketId) this.sockets.set(call.calleeSocketId, call.id);
    return Promise.resolve();
  }

  callOfSocket(socketId: string): Promise<string | null> {
    return Promise.resolve(this.sockets.get(socketId) ?? null);
  }

  finish(call: LiveCall): Promise<boolean> {
    if (!this.calls.delete(call.id)) return Promise.resolve(false);
    for (const map of [this.busy, this.sockets]) {
      for (const [key, value] of map) if (value === call.id) map.delete(key);
    }
    return Promise.resolve(true);
  }
}

const ALICE = 'alice';
const BOB = 'bob';
const CAROL = 'carol';

describe('CallsService', () => {
  const userTable = { findFirst: jest.fn() };
  const callLogTable = { create: jest.fn(), update: jest.fn() };
  const prisma = { user: userTable, callLog: callLogTable };
  const notifications = { callRinging: jest.fn(), callEnded: jest.fn() };
  const blocks = { eitherBlocked: jest.fn() };
  let store: MemoryCallStore;
  let calls: CallsService;
  let ended: [string, CallEndReason][];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    userTable.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'gone'
            ? null
            : { id: where.id, name: where.id === ALICE ? 'Alice' : null },
        ),
    );
    callLogTable.create.mockResolvedValue({});
    callLogTable.update.mockResolvedValue({});
    store = new MemoryCallStore();
    blocks.eitherBlocked.mockResolvedValue(false);
    calls = new CallsService(
      prisma as never,
      store,
      notifications as never,
      blocks as never,
    );
    ended = [];
    calls.onEnded((call, reason) => ended.push([call.id, reason]));
  });

  afterEach(() => {
    calls.onModuleDestroy();
    jest.useRealTimers();
  });

  const ring = (callId = 'c1', from = ALICE, to = BOB) =>
    calls.invite(from, `${from}-socket`, callId, to);

  it("rings the callee by the caller's name and records the call", async () => {
    const result = await ring();

    expect(result.ok).toBe(true);
    expect(callLogTable.create).toHaveBeenCalledWith({
      data: { id: 'c1', callerId: ALICE, calleeId: BOB },
    });
    expect(notifications.callRinging).toHaveBeenCalledWith({
      callId: 'c1',
      callerId: ALICE,
      callerName: 'Alice',
      calleeId: BOB,
    });
  });

  it('a block looks like nobody answering: no ring, no push, no record', async () => {
    blocks.eitherBlocked.mockResolvedValue(true);

    await expect(calls.invite(ALICE, 'sock-a', 'c1', BOB)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(blocks.eitherBlocked).toHaveBeenCalledWith(ALICE, BOB);
    expect(callLogTable.create).not.toHaveBeenCalled();
    expect(notifications.callRinging).not.toHaveBeenCalled();
  });

  it('refuses calling oneself, or someone who is gone', async () => {
    await expect(calls.invite(ALICE, 's', 'c1', ALICE)).resolves.toEqual({
      ok: false,
      reason: 'self',
    });
    await expect(calls.invite(ALICE, 's', 'c2', 'gone')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(callLogTable.create).not.toHaveBeenCalled();
  });

  it('one call at a time: a busy person cannot be called, nor call', async () => {
    await ring('c1', ALICE, BOB);

    await expect(ring('c2', CAROL, BOB)).resolves.toEqual({
      ok: false,
      reason: 'busy',
    });
    await expect(ring('c3', ALICE, CAROL)).resolves.toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(callLogTable.create).toHaveBeenCalledTimes(1);
  });

  it('a reused call id is refused and frees both people again', async () => {
    callLogTable.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );

    await expect(ring('c1')).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(ring('c2')).resolves.toMatchObject({ ok: true });
  });

  describe('answered', () => {
    beforeEach(() => ring());

    it('binds the answering device, and only the two devices can signal each other', async () => {
      const call = await calls.accept(BOB, 'bob-phone', 'c1');

      expect(call?.status).toBe('active');
      await expect(calls.peerSocket(ALICE, 'alice-socket', 'c1')).resolves.toBe(
        'bob-phone',
      );
      await expect(calls.peerSocket(BOB, 'bob-phone', 'c1')).resolves.toBe(
        'alice-socket',
      );
      await expect(
        calls.peerSocket(BOB, 'bob-tablet', 'c1'),
      ).resolves.toBeNull();
      await expect(
        calls.peerSocket(CAROL, 'alice-socket', 'c1'),
      ).resolves.toBeNull();
    });

    it("stops the callee's other phones ringing", async () => {
      await calls.accept(BOB, 'bob-phone', 'c1');

      expect(notifications.callEnded).toHaveBeenCalledWith(
        expect.objectContaining({ callId: 'c1', missed: false }),
      );
    });

    it('cannot be answered by anyone else, or twice', async () => {
      await expect(
        calls.accept(CAROL, 'carol-phone', 'c1'),
      ).resolves.toBeNull();
      await calls.accept(BOB, 'bob-phone', 'c1');
      await expect(calls.accept(BOB, 'bob-tablet', 'c1')).resolves.toBeNull();
    });

    it('nobody can signal before it is answered', async () => {
      await expect(
        calls.peerSocket(ALICE, 'alice-socket', 'c1'),
      ).resolves.toBeNull();
    });

    it('either may hang up; then both are free again', async () => {
      await calls.accept(BOB, 'bob-phone', 'c1');

      await calls.hangUp(BOB, 'c1');

      expect(ended).toEqual([['c1', 'ended']]);
      expect(
        callLogTable.update.mock.calls[
          callLogTable.update.mock.calls.length - 1
        ][0].data,
      ).toMatchObject({ status: 'ended', endReason: 'ended' });
      await expect(ring('c2', BOB, CAROL)).resolves.toMatchObject({ ok: true });
    });

    it('a dropped connection ends the call', async () => {
      await calls.accept(BOB, 'bob-phone', 'c1');

      await calls.socketGone('bob-phone');

      expect(ended).toEqual([['c1', 'disconnected']]);
    });
  });

  describe('never answered', () => {
    beforeEach(() => ring());

    it('stops ringing after a while and counts as missed', async () => {
      await jest.advanceTimersByTimeAsync(RING_SECONDS * 1000);

      expect(ended).toEqual([['c1', 'missed']]);
      expect(notifications.callEnded).toHaveBeenCalledWith(
        expect.objectContaining({ missed: true }),
      );
    });

    it('the caller giving up is a missed call for the callee', async () => {
      await calls.hangUp(ALICE, 'c1');

      expect(ended).toEqual([['c1', 'cancelled']]);
      expect(notifications.callEnded).toHaveBeenCalledWith(
        expect.objectContaining({ missed: true }),
      );
    });

    it('declined is not missed', async () => {
      await calls.decline(BOB, 'c1');

      expect(ended).toEqual([['c1', 'declined']]);
      expect(notifications.callEnded).toHaveBeenCalledWith(
        expect.objectContaining({ missed: false }),
      );
    });

    it('only the callee may decline', async () => {
      await expect(calls.decline(ALICE, 'c1')).resolves.toBe(false);
      await expect(calls.decline(CAROL, 'c1')).resolves.toBe(false);
      expect(ended).toEqual([]);
    });

    it("the caller's connection dropping cancels it; a callee device closing does not", async () => {
      await calls.socketGone('bob-tablet');
      expect(ended).toEqual([]);

      await calls.socketGone('alice-socket');
      expect(ended).toEqual([['c1', 'cancelled']]);
    });

    it('ends once, however many ways it is ended at the same time', async () => {
      await Promise.all([calls.hangUp(ALICE, 'c1'), calls.decline(BOB, 'c1')]);
      await jest.advanceTimersByTimeAsync(RING_SECONDS * 1000);

      expect(ended).toHaveLength(1);
    });
  });
});
