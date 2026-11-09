import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminLoginService } from './admin-login.service';

jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('Admin email login', () => {
  const admin = {
    id: 'owner',
    role: 'admin',
    email: 'owner@example.com',
    email_verified: true,
    password_hash: 'hash',
    deactivated_at: null,
  };
  const client = { deviceName: null, platform: null, ipAddress: null };
  const users = { findById: jest.fn() };
  const signIn = { complete: jest.fn() };
  const mail = { deliver: jest.fn() };
  const limits = { resetCooldown: { consumeOrReject: jest.fn() } };
  const records = new Map<string, string>();
  const redis = {
    client: {
      set: jest.fn(async (key: string, value: string) => {
        records.set(key, value);
        return 'OK';
      }),
      getdel: jest.fn(async (key: string) => {
        const value = records.get(key);
        records.delete(key);
        return value;
      }),
      del: jest.fn(async (key: string) => records.delete(key)),
    },
  };
  const service = new AdminLoginService(
    users as never,
    signIn as never,
    mail as never,
    limits as never,
    redis as never,
  );
  const tokenFromEmail = () =>
    /token=([A-Za-z0-9_-]{43})/.exec(mail.deliver.mock.calls[0][0].html)![1];

  beforeEach(() => {
    jest.clearAllMocks();
    records.clear();
    users.findById.mockResolvedValue(admin);
    mail.deliver.mockResolvedValue(true);
    signIn.complete.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  });

  it('emails a single-use link and issues no session until exchange', async () => {
    await expect(service.start(admin as never)).resolves.toEqual({
      status: 'admin_email_required',
    });
    expect(signIn.complete).not.toHaveBeenCalled();
    const token = tokenFromEmail();
    expect(redis.client.set).toHaveBeenCalledWith(
      expect.not.stringContaining(token),
      expect.any(String),
      'EX',
      600,
      'NX',
    );
    expect(mail.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ to: admin.email }),
    );
    const results = await Promise.allSettled([
      service.complete(token, client),
      service.complete(token, client),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(signIn.complete).toHaveBeenCalledTimes(1);
    expect(signIn.complete).toHaveBeenCalledWith(admin, client, {
      adminEmailVerified: true,
    });
  });

  it('refuses missing, malformed and expired links', async () => {
    await expect(service.complete('bad', client)).rejects.toThrow(
      UnauthorizedException,
    );
    await service.start(admin as never);
    records.clear(); // Redis has removed the record after its TTL.
    await expect(service.complete(tokenFromEmail(), client)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'user' },
    { email_verified: false },
    { email: 'changed@example.com' },
    { password_hash: 'changed' },
    { deactivated_at: new Date() },
  ])('rejects a changed account: %j', async (change) => {
    await service.start(admin as never);
    users.findById.mockResolvedValue({ ...admin, ...change });
    await expect(service.complete(tokenFromEmail(), client)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it('invalidates the challenge if mail delivery fails', async () => {
    mail.deliver.mockResolvedValue(false);
    await expect(service.start(admin as never)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(records.size).toBe(0);
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it('never falls back to password-only access when Redis is unavailable', async () => {
    redis.client.set.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.start(admin as never)).rejects.toThrow(
      'Redis unavailable',
    );
    expect(mail.deliver).not.toHaveBeenCalled();
    expect(signIn.complete).not.toHaveBeenCalled();
  });
});
