import { distanceMeters, rankByDistance } from './closest-listings';

const PHNOM_PENH = { lat: 11.5564, lng: 104.9282 };

describe('distanceMeters', () => {
  it('is zero from a point to itself', () => {
    expect(distanceMeters(PHNOM_PENH, PHNOM_PENH)).toBe(0);
  });

  it('measures Phnom Penh to Siem Reap at about 230 km', () => {
    const siemReap = { lat: 13.3633, lng: 103.8564 };
    const km = distanceMeters(PHNOM_PENH, siemReap) / 1000;
    expect(km).toBeGreaterThan(225);
    expect(km).toBeLessThan(235);
  });
});

describe('rankByDistance', () => {
  it('puts the nearest first, with whole metres', () => {
    const ranked = rankByDistance(PHNOM_PENH, [
      { id: 'far', lat: 11.6, lng: 104.9282 },
      { id: 'near', lat: 11.5574, lng: 104.9282 },
      { id: 'middle', lat: 11.57, lng: 104.9282 },
    ]);

    expect(ranked.map((p) => p.id)).toEqual(['near', 'middle', 'far']);
    expect(Number.isInteger(ranked[0].distanceMeters)).toBe(true);
    expect(ranked[0].distanceMeters).toBeGreaterThan(100);
    expect(ranked[0].distanceMeters).toBeLessThan(120);
  });

  it('orders equally far listings by id, so pages cut the same way', () => {
    const same = { lat: 11.56, lng: 104.93 };
    const ranked = rankByDistance(PHNOM_PENH, [
      { id: 'b', ...same },
      { id: 'c', ...same },
      { id: 'a', ...same },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
