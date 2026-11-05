import {
  isKept,
  isPublished,
  planRotation,
  SigningKeyDates,
} from './signing-key-policy';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = new Date('2026-11-05T00:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function key(
  kid: string,
  activatesAt: Date,
  retiredAt: Date | null = null,
): SigningKeyDates {
  return { kid, hasPrivateKey: true, activatesAt, retiredAt };
}

describe('signing key policy', () => {
  it('creates a key at once when there is none to sign with', () => {
    expect(planRotation([], new Set(), NOW, 30).create).toBe('now');
  });

  it('creates a key at once when this process cannot decrypt the current one', () => {
    const keys = [key('k1', ago(DAY))];

    expect(planRotation(keys, new Set(), NOW, 30).create).toBe('now');
  });

  it('leaves a key younger than the rotation period alone', () => {
    const keys = [key('k1', ago(29 * DAY))];

    expect(planRotation(keys, new Set(['k1']), NOW, 30)).toEqual({
      create: null,
      deleteKids: [],
    });
  });

  it('publishes a successor first once the current key is due', () => {
    const keys = [key('k1', ago(30 * DAY))];

    expect(planRotation(keys, new Set(['k1']), NOW, 30).create).toBe(
      'scheduled',
    );
  });

  it('does not create a second successor while one is waiting to activate', () => {
    const keys = [
      key('k1', ago(31 * DAY)),
      key('k2', new Date(NOW.getTime() + 30 * MINUTE)),
    ];

    expect(
      planRotation(keys, new Set(['k1', 'k2']), NOW, 30).create,
    ).toBeNull();
  });

  it('unpublishes a retired key once its access tokens have expired, and deletes it after the refresh tokens', () => {
    const retired = key('old', ago(60 * DAY), ago(21 * MINUTE));
    expect(isPublished(retired, NOW)).toBe(false);
    expect(isKept(retired, NOW)).toBe(true);
    expect(isPublished(key('old', ago(60 * DAY), ago(19 * MINUTE)), NOW)).toBe(
      true,
    );

    const gone = key('older', ago(90 * DAY), ago(32 * DAY));
    expect(isKept(gone, NOW)).toBe(false);
    expect(
      planRotation([gone, key('k1', ago(DAY))], new Set(['k1']), NOW, 30)
        .deleteKids,
    ).toEqual(['older']);
  });

  it('never signs with the imported pre-rotation key', () => {
    const legacy = {
      kid: 'legacy',
      hasPrivateKey: false,
      activatesAt: ago(DAY),
      retiredAt: ago(DAY),
    };

    expect(planRotation([legacy], new Set(), NOW, 30).create).toBe('now');
  });
});
