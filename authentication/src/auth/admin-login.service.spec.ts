import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AdminLoginService } from './admin-login.service';

jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('AdminLoginService', () => {
  const original = { ...process.env };
  const client = {
    deviceName: 'Test phone',
    platform: 'Android',
    ipAddress: '203.0.113.5',
  };
  const users = { findByEmail: jest.fn(), findById: jest.fn() };
  const signIn = { complete: jest.fn() };
  const mail = { deliver: jest.fn() };
  const limit = { consumeOrReject: jest.fn(), reset: jest.fn() };
  const store = new Map<string, string>();
  const redis = {
    client: {
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      getdel: jest.fn(async (key: string) => {
        const value = store.get(key);
        store.delete(key);
        return value ?? null;
      }),
      del: jest.fn(async (key: string) => store.delete(key)),
    },
  };
  let service: AdminLoginService;
  let user: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    process.env.ADMIN_LOGIN_EMAIL = 'owner@example.com';
    process.env.ADMIN_APP_LINK_URL = 'https://app.example.com/admin-login';
    user = {
      id: 'admin-1',
      email: 'owner@example.com',
      role: 'admin',
      has_password: true,
      password_hash: bcrypt.hashSync('test-password', 4),
      deactivated_at: null,
    };
    users.findByEmail.mockResolvedValue(user);
    users.findById.mockResolvedValue(user);
    mail.deliver.mockResolvedValue(true);
    signIn.complete.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    service = new AdminLoginService(
      users as never,
      signIn as never,
      mail as never,
      { loginPerSource: limit, loginPerNetwork: limit } as never,
      redis as never,
    );
  });
  afterAll(() => {
    process.env = original;
  });

  async function emailedToken() {
    await service.start('owner@example.com', 'test-password', client);
    const html = mail.deliver.mock.calls[0][0].html as string;
    return new URL(/href="([^"]+)"/.exec(html)![1]).searchParams.get('token')!;
  }

  it('issues no session before email proof, then consumes the link only once', async () => {
    const token = await emailedToken();
    expect(signIn.complete).not.toHaveBeenCalled();
    expect([...store.keys()].join('')).not.toContain(token);
    await expect(service.complete(token, client)).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    });
    expect(signIn.complete).toHaveBeenCalledWith(user, client, {
      adminEmailVerified: true,
    });
    await expect(service.complete(token, client)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signIn.complete).toHaveBeenCalledTimes(1);
  });

  it('sends no email for incorrect credentials or a non-admin', async () => {
    await expect(
      service.start('owner@example.com', 'wrong-password', client),
    ).rejects.toThrow(UnauthorizedException);
    users.findByEmail.mockResolvedValue({ ...user, role: 'user' });
    await expect(
      service.start('owner@example.com', 'test-password', client),
    ).rejects.toThrow(UnauthorizedException);
    expect(mail.deliver).not.toHaveBeenCalled();
  });

  it('rechecks the live role when the emailed link is opened', async () => {
    const token = await emailedToken();
    users.findById.mockResolvedValue({ ...user, role: 'user' });
    await expect(service.complete(token, client)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it('removes an undelivered challenge', async () => {
    mail.deliver.mockResolvedValue(false);
    await expect(
      service.start('owner@example.com', 'test-password', client),
    ).rejects.toThrow('could not be delivered');
    expect(store.size).toBe(0);
  });
});
