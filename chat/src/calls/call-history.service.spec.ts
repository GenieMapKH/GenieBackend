import { CallHistoryService, MAX_HISTORY_CALLS } from './call-history.service';

const call = (id: string, createdAt: string) => ({
  id,
  callerId: 'alice',
  createdAt: new Date(createdAt),
  answeredAt: null,
  endedAt: new Date(createdAt),
  endReason: 'missed',
});

describe('CallHistoryService', () => {
  const callLogs = { findMany: jest.fn() };
  const states = { clearedAt: jest.fn() };
  let history: CallHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    states.clearedAt.mockResolvedValue(null);
    history = new CallHistoryService(
      { callLog: callLogs } as never,
      states as never,
    );
  });

  it('lists the finished calls between the two people, oldest first', async () => {
    callLogs.findMany.mockResolvedValue([
      call('c2', '2026-10-19T10:05:00Z'),
      call('c1', '2026-10-19T10:00:00Z'),
    ]);

    const calls = await history.between('alice', 'bob');

    expect(calls.map((c) => c.id)).toEqual(['c1', 'c2']);
    const query = callLogs.findMany.mock.calls[0][0];
    expect(query.where.status).toBe('ended');
    expect(query.where.OR).toEqual([
      { callerId: 'alice', calleeId: 'bob' },
      { callerId: 'bob', calleeId: 'alice' },
    ]);
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
    expect(query.where.createdAt).toBeUndefined();
  });

  it('hides the calls from before "delete for me"', async () => {
    const clearedAt = new Date('2026-10-19T09:00:00Z');
    states.clearedAt.mockResolvedValue(clearedAt);
    callLogs.findMany.mockResolvedValue([]);

    await history.between('alice', 'bob');

    expect(states.clearedAt).toHaveBeenCalledWith('alice', 'bob');
    expect(callLogs.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gt: clearedAt,
    });
  });

  it('never returns more than the maximum', async () => {
    callLogs.findMany.mockResolvedValue([]);

    await history.between('alice', 'bob', 5000);

    expect(callLogs.findMany.mock.calls[0][0].take).toBe(MAX_HISTORY_CALLS);
  });

  it('does not select anything beyond what the chat shows', async () => {
    callLogs.findMany.mockResolvedValue([]);

    await history.between('alice', 'bob');

    expect(
      Object.keys(callLogs.findMany.mock.calls[0][0].select).sort(),
    ).toEqual([
      'answeredAt',
      'callerId',
      'createdAt',
      'endReason',
      'endedAt',
      'id',
    ]);
  });
});
