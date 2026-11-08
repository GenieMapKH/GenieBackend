import { generateKeyPairSync } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthAttemptLimits } from '../attempt-limiter';
import { TokenSigner } from '../signing-keys/token-signer.service';
import { EmailVerificationService } from './email-verification.service';

describe('email ownership verification', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signer = new TokenSigner({
    signingKey: () => ({ kid: 'test', privateKey: keys.privateKey }),
    keptKey: (kid: string) => (kid === 'test' ? keys.publicKey : undefined),
  } as never);
  const table = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  };
  const mail = { deliver: jest.fn() };
  let service: EmailVerificationService;
  beforeEach(() => {
    jest.resetAllMocks();
    mail.deliver.mockResolvedValue(true);
    table.deleteMany.mockResolvedValue({ count: 1 });
    service = new EmailVerificationService(
      { emailVerification: table } as never,
      new AuthAttemptLimits(),
      mail as never,
      signer,
    );
  });

  it('stores a hash and sends the actual code without exposing it in the API', async () => {
    await service.request('a@example.test', '192.0.2.1');
    const sent = mail.deliver.mock.calls[0][0];
    const code = sent.subject.slice(0, 6);
    expect(code).toMatch(/^\d{6}$/);
    const saved = table.upsert.mock.calls[0][0].create;
    expect(saved.codeHash).not.toBe(code);
    expect(await bcrypt.compare(code, saved.codeHash)).toBe(true);
    expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(sent.html).toContain('verify this email address');
    await expect(
      service.request('a@example.test', '192.0.2.1'),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('does not claim delivery when no provider accepted the email', async () => {
    mail.deliver.mockResolvedValue(false);
    await expect(service.request('a@example.test', null)).rejects.toMatchObject(
      { status: 503 },
    );
  });

  it('issues an address-bound proof after atomically consuming the code', async () => {
    table.findUnique.mockResolvedValue({
      codeHash: await bcrypt.hash('123456', 4),
      expiresAt: new Date(Date.now() + 60000),
    });
    const { proofToken } = await service.confirm('a@example.test', '123456');
    expect(() =>
      service.requireProof('a@example.test', proofToken),
    ).not.toThrow();
    expect(() => service.requireProof('b@example.test', proofToken)).toThrow();
    table.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.confirm('a@example.test', '123456'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses wrong or expired codes, and stops repeated guesses', async () => {
    table.findUnique.mockResolvedValue({
      codeHash: await bcrypt.hash('123456', 4),
      expiresAt: new Date(Date.now() + 60000),
    });
    for (let n = 0; n < 5; n++)
      await expect(
        service.confirm('a@example.test', '000000'),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.confirm('a@example.test', '123456'),
    ).rejects.toMatchObject({ status: 429 });
    expect(table.deleteMany).not.toHaveBeenCalled();
    table.findUnique.mockResolvedValue({
      codeHash: await bcrypt.hash('123456', 4),
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(
      service.confirm('other@example.test', '123456'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('never accepts a forged, missing, expired or wrong-purpose proof', () => {
    for (const proof of [
      undefined,
      'forged',
      signer.sign({ sub: 'a@example.test', typ: 'access' }, 300),
      signer.sign({ sub: 'a@example.test', typ: 'email-verification' }, -1),
    ])
      expect(() => service.requireProof('a@example.test', proof)).toThrow();
  });
});
