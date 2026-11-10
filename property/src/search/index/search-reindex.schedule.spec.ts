import { msUntilHour, SearchReindexSchedule } from './search-reindex.schedule';

describe('msUntilHour', () => {
  it('waits until that hour today when it is still ahead', () => {
    expect(msUntilHour(new Date('2026-10-20T19:30:00Z'), 20)).toBe(
      30 * 60 * 1000,
    );
  });

  it('waits until tomorrow once the hour has come', () => {
    expect(msUntilHour(new Date('2026-10-20T20:00:00Z'), 20)).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});

describe('SearchReindexSchedule', () => {
  it('does not start a second rebuild while one runs', async () => {
    let finish: () => void = () => undefined;
    const sync = {
      reindexAll: jest.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      ),
    };
    const schedule = new SearchReindexSchedule(
      { isConfigured: true } as never,
      sync as never,
    );

    const first = schedule.reindex('test');
    await schedule.reindex('again');
    finish();
    await first;

    expect(sync.reindexAll).toHaveBeenCalledTimes(1);
  });

  it('logs a failed rebuild instead of throwing', async () => {
    const sync = {
      reindexAll: jest.fn().mockRejectedValue(new Error('engine down')),
    };
    const schedule = new SearchReindexSchedule(
      { isConfigured: true } as never,
      sync as never,
    );

    await expect(schedule.reindex('test')).resolves.toBeUndefined();
  });

  it('does nothing without an engine', () => {
    const engine = { isConfigured: false, prepare: jest.fn() };
    new SearchReindexSchedule(
      engine as never,
      {} as never,
    ).onApplicationBootstrap();

    expect(engine.prepare).not.toHaveBeenCalled();
  });
});
