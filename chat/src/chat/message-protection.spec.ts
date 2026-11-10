import { MessageProtection, MANAGED_MESSAGE } from './message-protection';

describe('managed message encryption', () => {
  const parties = { id: 'message', senderId: 'alice', recipientId: 'bob' };
  const body = {
    ciphertext: Buffer.from(
      JSON.stringify({
        v: 1,
        id: 'message',
        from: 'alice',
        to: 'bob',
        text: 'Private text',
      }),
    ).toString('base64'),
    nonce: MANAGED_MESSAGE,
  };
  beforeEach(() => {
    process.env.CHAT_MESSAGE_SECRET = 'test-only-message-secret-32-characters';
  });
  afterEach(() => {
    delete process.env.CHAT_MESSAGE_SECRET;
  });
  it('encrypts at rest, opens after restart, and uses a fresh IV', () => {
    const protection = new MessageProtection();
    const stored = protection.seal(body, parties);
    expect(stored.ciphertext).not.toBe(body.ciphertext);
    expect(protection.seal(body, parties).ciphertext).not.toBe(
      stored.ciphertext,
    );
    expect(new MessageProtection().open(stored, parties)).toEqual(body);
  });
  it('refuses altered data or a different message or recipient', () => {
    const protection = new MessageProtection();
    const stored = protection.seal(body, parties);
    expect(() =>
      protection.open(stored, { ...parties, recipientId: 'eve' }),
    ).toThrow();
    expect(() =>
      protection.open(stored, { ...parties, id: 'replayed' }),
    ).toThrow();
    const bytes = Buffer.from(stored.ciphertext, 'base64');
    bytes[30] ^= 1;
    expect(() =>
      protection.open(
        { ...stored, ciphertext: bytes.toString('base64') },
        parties,
      ),
    ).toThrow();
  });
  it('rejects forged envelopes and fails closed without its storage secret', () => {
    expect(() =>
      new MessageProtection().seal(body, { ...parties, senderId: 'eve' }),
    ).toThrow('Invalid message content');
    delete process.env.CHAT_MESSAGE_SECRET;
    expect(() => new MessageProtection().seal(body, parties)).toThrow(
      'not configured',
    );
  });
  it('leaves older records inaccessible and rejects old-format sends', () => {
    const legacy = { ciphertext: 'legacy', nonce: 'old-nonce' };
    expect(() => new MessageProtection().seal(legacy, parties)).toThrow(
      'Update the app',
    );
    expect(new MessageProtection().open(legacy, parties)).toEqual({
      ciphertext: '',
      nonce: 'legacy-unavailable',
    });
  });
});
