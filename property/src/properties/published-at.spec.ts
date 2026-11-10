import { datesAnew, publishedAtGoingLive } from './published-at';

const FIRST = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-10-21T00:00:00.000Z');

describe('publishedAtGoingLive', () => {
  it('dates a listing never live before as now', () => {
    expect(publishedAtGoingLive('Draft', null, NOW)).toBe(NOW);
  });

  it('keeps the first date of a listing unpublished and published again', () => {
    expect(publishedAtGoingLive('Draft', FIRST, NOW)).toBe(FIRST);
  });

  it.each(['Sold', 'Expired'])(
    'dates a listing back on the market from %s as now',
    (from) => {
      expect(publishedAtGoingLive(from, FIRST, NOW)).toBe(NOW);
    },
  );

  it('says which statuses date a listing anew', () => {
    expect(['Draft', 'Pending', 'Sold', 'Expired'].filter(datesAnew)).toEqual([
      'Sold',
      'Expired',
    ]);
  });
});
