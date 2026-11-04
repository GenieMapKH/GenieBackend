import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthAttemptLimits } from '../attempt-limiter';
import { PhonePasswordResetService } from './phone-password-reset.service';

// firebase-admin pulls in ESM-only packages Jest cannot load.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const PHONE = '+85512345678';
const now = () => Math.floor(Date.now() / 1000);

describe('PhonePasswordResetService', () => {
  const firebase = { verifyIdToken: jest.fn() };
  const users = { findByPhone: jest.fn(), update: jest.fn() };
  const sessions = { endAllSessions: jest.fn() };
  let service: PhonePasswordResetService;

  const smsToken = (overrides: object = {}) => ({
    uid: 'fb-phone',
    phone_number: PHONE,
    auth_time: now() - 30,
    firebase: { sign_in_provider: 'phone' },
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    users.findByPhone.mockResolvedValue({ id: 'u1' });
    service = new PhonePasswordResetService(
      firebase as never,
      users as never,
      sessions as never,
      new AuthAttemptLimits(),
    );
  });

  it('sets the new password of the account with the proven number and signs it out everywhere', async () => {
    firebase.verifyIdToken.mockResolvedValue(smsToken());

    await service.reset('id-token', 'new-password');

    expect(users.findByPhone).toHaveBeenCalledWith(PHONE);
    const patch = users.update.mock.calls[0][1] as {
      password_hash: string;
      has_password: boolean;
    };
    expect(users.update.mock.calls[0][0]).toBe('u1');
    expect(await bcrypt.compare('new-password', patch.password_hash)).toBe(
      true,
    );
    expect(patch.has_password).toBe(true);
    expect(sessions.endAllSessions).toHaveBeenCalledWith('u1');
  });

  it('refuses a token Firebase does not accept', async () => {
    firebase.verifyIdToken.mockRejectedValue(new Error('bad signature'));

    await expect(service.reset('forged', 'new-password')).rejects.toThrow(
      BadRequestException,
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses a Google sign-in, even one that carries a phone number', async () => {
    firebase.verifyIdToken.mockResolvedValue(
      smsToken({ firebase: { sign_in_provider: 'google.com' } }),
    );

    await expect(service.reset('id-token', 'new-password')).rejects.toThrow(
      BadRequestException,
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses a code confirmed more than 5 minutes ago', async () => {
    firebase.verifyIdToken.mockResolvedValue(
      smsToken({ auth_time: now() - 6 * 60 }),
    );

    await expect(service.reset('id-token', 'new-password')).rejects.toThrow(
      BadRequestException,
    );
    expect(users.update).not.toHaveBeenCalled();
  });

  it('says when no account uses the number', async () => {
    firebase.verifyIdToken.mockResolvedValue(smsToken());
    users.findByPhone.mockResolvedValue(null);

    await expect(service.reset('id-token', 'new-password')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allows 5 resets per number a day', async () => {
    firebase.verifyIdToken.mockResolvedValue(smsToken());
    for (let i = 0; i < 5; i++) await service.reset('id-token', 'new-password');

    await expect(
      service.reset('id-token', 'new-password'),
    ).rejects.toMatchObject({ status: 429 });
  });
});
