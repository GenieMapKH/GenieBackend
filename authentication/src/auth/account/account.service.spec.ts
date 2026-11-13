import {
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthAttemptLimits } from '../attempt-limiter';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { IdentityProofService } from './identity-proof.service';
import { PasswordProofService } from './password-proof.service';
import { UserContentClient } from './user-content.client';

// firebase-admin pulls in ESM-only packages Jest cannot load; a stub stands in below.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const PASSWORD = 'correct-password';
const NOW_SECONDS = Date.parse('2026-03-01T12:00:00Z') / 1000;

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  role: 'user',
  email: 'owner@example.com',
  password_hash: bcrypt.hashSync(PASSWORD, 4),
  has_password: true,
  firebase_uid: null,
  deactivated_at: null,
  ...overrides,
});

describe('IdentityProofService', () => {
  const users = { findById: jest.fn() };
  const firebase = { verifyIdToken: jest.fn() };
  let proofs: IdentityProofService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({
      now: NOW_SECONDS * 1000,
      doNotFake: ['nextTick', 'setImmediate'],
    });
    proofs = new IdentityProofService(users as never, firebase as never);
    users.findById.mockResolvedValue(account({ firebase_uid: 'fb1' }));
  });

  afterEach(() => jest.useRealTimers());

  it('accepts the account password', async () => {
    await expect(
      proofs.verify('u1', { password: PASSWORD }),
    ).resolves.toMatchObject({ id: 'u1' });
  });

  it('answers 403, not 401, for a wrong password: 401 would sign the app out', async () => {
    await expect(proofs.verify('u1', { password: 'guess' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('accepts a Google sign-in from the last few minutes', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb1',
      auth_time: NOW_SECONDS - 60,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });

    await expect(
      proofs.verify('u1', { idToken: 'fresh' }),
    ).resolves.toMatchObject({ id: 'u1' });
  });

  it.each([
    ['a future Google sign-in', { uid: 'fb1', auth_time: NOW_SECONDS + 60 }],
    [
      'an unverified email',
      { uid: 'fb1', auth_time: NOW_SECONDS, email_verified: false },
    ],
    [
      'a different provider',
      {
        uid: 'fb1',
        auth_time: NOW_SECONDS,
        firebase: { sign_in_provider: 'password' },
      },
    ],
    ['an old Google sign-in', { uid: 'fb1', auth_time: NOW_SECONDS - 3600 }],
    [
      "someone else's Google account",
      { uid: 'fb-other', auth_time: NOW_SECONDS - 60 },
    ],
  ])('refuses %s', async (_case, token) => {
    firebase.verifyIdToken.mockResolvedValue({
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
      ...token,
    });

    await expect(proofs.verify('u1', { idToken: 'token' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a token Firebase rejects, and a Google proof for an account without Google', async () => {
    firebase.verifyIdToken.mockRejectedValue(new Error('invalid'));
    await expect(proofs.verify('u1', { idToken: 'forged' })).rejects.toThrow(
      ForbiddenException,
    );

    users.findById.mockResolvedValue(account());
    await expect(proofs.verify('u1', { idToken: 'fresh' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses when nothing is offered as proof', async () => {
    await expect(proofs.verify('u1', {})).rejects.toThrow(ForbiddenException);
  });

  it('reports an account that no longer exists', async () => {
    users.findById.mockResolvedValue(null);

    await expect(proofs.verify('u1', { password: PASSWORD })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PasswordProofService', () => {
  const users = { findById: jest.fn() };
  const jwt = { sign: jest.fn() };
  let service: PasswordProofService;

  beforeEach(() => {
    jest.resetAllMocks();
    users.findById.mockResolvedValue(account());
    jwt.sign.mockReturnValue('signed-proof');
    service = new PasswordProofService(
      jwt as never,
      new IdentityProofService(users as never, {} as never),
    );
  });

  it('gives a five-minute proof to someone who typed the right password', async () => {
    await expect(service.issue('u1', PASSWORD)).resolves.toEqual({
      proofToken: 'signed-proof',
      expiresInSeconds: 300,
    });

    // Its own type: nothing that accepts an access token will take it, and the other way round.
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'u1', typ: 'password-proof' },
      300,
    );
  });

  it('gives nothing for a wrong password', async () => {
    await expect(service.issue('u1', 'guess')).rejects.toThrow(
      ForbiddenException,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});

describe('AccountService', () => {
  const users = {
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createInitialPassword: jest.fn(),
  };
  const sessions = { endAllSessions: jest.fn() };
  /** The one-day rule: `require` rejects for a device that signed in less than a day ago. */
  const devices = { require: jest.fn() };
  const tooNew = new ForbiddenException({ code: 'DEVICE_TOO_NEW' });
  const caller = { userId: 'u1', sessionId: 'this-session' };
  const content = { eraseFiles: jest.fn(), visibilityChanged: jest.fn() };
  const otps = { deleteAllFor: jest.fn() };
  const firebase = { verifyIdToken: jest.fn(), deleteUser: jest.fn() };
  let service: AccountService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({
      now: NOW_SECONDS * 1000,
      doNotFake: ['nextTick', 'setImmediate'],
    });
    users.findById.mockResolvedValue(account());
    service = new AccountService(
      users as never,
      sessions as never,
      devices as never,
      new IdentityProofService(users as never, firebase as never),
      content as never,
      otps as never,
      firebase as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('bans regular accounts, revokes sessions and never reactivates a banned account', async () => {
    await service.adminBan('u1');
    expect(users.update).toHaveBeenCalledWith('u1', {
      banned_at: expect.any(String),
      deactivated_at: expect.any(String),
    });
    expect(sessions.endAllSessions).toHaveBeenCalledWith('u1');
    expect(content.visibilityChanged).toHaveBeenCalledWith('u1');
    await expect(
      service.reactivate({
        ...account(),
        phone: null,
        username: null,
        name: null,
        avatar_url: null,
        banned_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('protects administrator accounts from bans and deletion', async () => {
    users.findById.mockResolvedValue(account({ role: 'admin' }));
    await expect(service.adminBan('u1')).rejects.toThrow(ForbiddenException);
    await expect(service.adminDelete('u1')).rejects.toThrow(ForbiddenException);
    expect(users.update).not.toHaveBeenCalled();
    expect(users.delete).not.toHaveBeenCalled();
    expect(content.eraseFiles).not.toHaveBeenCalled();
  });

  it('admin deletion reuses file cleanup and does not delete the account when cleanup fails', async () => {
    content.eraseFiles.mockRejectedValue(new Error('Storage unavailable'));
    await expect(service.adminDelete('u1')).rejects.toThrow(
      'Storage unavailable',
    );
    expect(users.delete).not.toHaveBeenCalled();
    expect(users.update).toHaveBeenLastCalledWith('u1', {
      deactivated_at: null,
    });
  });

  describe('changePassword', () => {
    it('stores a hash of the new password and signs out every other device', async () => {
      await service.changePassword(caller, PASSWORD, 'a-new-password');

      const patch = users.update.mock.calls[0][1];
      expect(await bcrypt.compare('a-new-password', patch.password_hash)).toBe(
        true,
      );
      expect(sessions.endAllSessions).toHaveBeenCalledWith(
        'u1',
        'this-session',
      );
    });

    it('changes nothing when the current password is wrong', async () => {
      await expect(
        service.changePassword(caller, 'guess', 'a-new-password'),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
      expect(sessions.endAllSessions).not.toHaveBeenCalled();
    });
  });

  describe('createPassword, for an account that signs in with Google', () => {
    beforeEach(() => {
      users.findById.mockResolvedValue(
        account({ firebase_uid: 'fb1', has_password: false }),
      );
    });

    it('sets the first password after a fresh Google sign-in', async () => {
      firebase.verifyIdToken.mockResolvedValue({
        uid: 'fb1',
        auth_time: NOW_SECONDS - 30,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      });

      await service.createPassword(
        caller,
        'fresh-id-token',
        'my-first-password',
      );

      const [id, uid, hash] = users.createInitialPassword.mock.calls[0];
      expect([id, uid]).toEqual(['u1', 'fb1']);
      expect(await bcrypt.compare('my-first-password', hash)).toBe(true);
      expect(sessions.endAllSessions).toHaveBeenCalledWith(
        'u1',
        'this-session',
      );
    });

    it('sets nothing when Google does not confirm the owner', async () => {
      firebase.verifyIdToken.mockResolvedValue({
        uid: 'fb-other',
        auth_time: NOW_SECONDS - 30,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      });

      await expect(
        service.createPassword(caller, 'id-token', 'my-first-password'),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('hides the account at once and signs every device out, keeping the data', async () => {
      await service.deactivate(caller, { password: PASSWORD });

      expect(users.update).toHaveBeenCalledWith('u1', {
        deactivated_at: expect.any(String),
      });
      expect(sessions.endAllSessions).toHaveBeenCalledWith('u1');
      expect(content.visibilityChanged).toHaveBeenCalledWith('u1');
      expect(users.delete).not.toHaveBeenCalled();
      expect(content.eraseFiles).not.toHaveBeenCalled();
    });

    it('needs proof', async () => {
      await expect(
        service.deactivate(caller, { password: 'guess' }),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes every trace: files, sessions, reset codes, the Google record and the account', async () => {
      users.findById.mockResolvedValue(account({ firebase_uid: 'fb1' }));
      const order: string[] = [];
      users.update.mockImplementation(async () => void order.push('hide'));
      content.eraseFiles.mockImplementation(
        async () => void order.push('erase files'),
      );
      sessions.endAllSessions.mockImplementation(
        async () => void order.push('sign out'),
      );
      users.delete.mockImplementation(
        async () => void order.push('delete account'),
      );

      await service.delete(caller, { password: PASSWORD });

      // Hidden first, so nobody is shown a listing whose photos are gone; the
      // files before the rows, because the rows say which files there are.
      expect(order).toEqual([
        'hide',
        'erase files',
        'sign out',
        'delete account',
      ]);
      expect(content.eraseFiles).toHaveBeenCalledWith('u1');
      expect(firebase.deleteUser).toHaveBeenCalledWith('fb1');
      expect(otps.deleteAllFor).toHaveBeenCalledWith('owner@example.com');
    });

    it('deletes nothing, and shows the account again, when its files could not be erased', async () => {
      content.eraseFiles.mockRejectedValue(new ServiceUnavailableException());

      await expect(
        service.delete(caller, { password: PASSWORD }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(users.update).toHaveBeenLastCalledWith('u1', {
        deactivated_at: null,
      });
      expect(sessions.endAllSessions).not.toHaveBeenCalled();
      expect(users.delete).not.toHaveBeenCalled();
    });

    it('needs proof', async () => {
      await expect(
        service.delete(caller, { password: 'guess' }),
      ).rejects.toThrow(ForbiddenException);
      expect(content.eraseFiles).not.toHaveBeenCalled();
      expect(users.delete).not.toHaveBeenCalled();
    });
  });

  describe('on a device that signed in less than a day ago', () => {
    beforeEach(() => devices.require.mockRejectedValue(tooNew));

    it('the password cannot be changed, even with the right password', async () => {
      await expect(
        service.changePassword(caller, PASSWORD, 'a-new-password'),
      ).rejects.toBe(tooNew);

      expect(users.update).not.toHaveBeenCalled();
      expect(sessions.endAllSessions).not.toHaveBeenCalled();
    });

    it('the account cannot be deactivated or deleted', async () => {
      await expect(
        service.deactivate(caller, { password: PASSWORD }),
      ).rejects.toBe(tooNew);
      await expect(service.delete(caller, { password: PASSWORD })).rejects.toBe(
        tooNew,
      );

      expect(users.update).not.toHaveBeenCalled();
      expect(content.eraseFiles).not.toHaveBeenCalled();
      expect(users.delete).not.toHaveBeenCalled();
    });

    it('a first password can still be created: that takes nothing away from other devices', async () => {
      users.findById.mockResolvedValue(
        account({ firebase_uid: 'fb1', has_password: false }),
      );
      firebase.verifyIdToken.mockResolvedValue({
        uid: 'fb1',
        auth_time: NOW_SECONDS - 30,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      });

      await expect(
        service.createPassword(caller, 'fresh-id-token', 'my-first-password'),
      ).resolves.toBeUndefined();
    });
  });

  describe('reactivate', () => {
    it('shows a deactivated account again, at once', async () => {
      await service.reactivate(
        account({ deactivated_at: '2026-01-01T00:00:00Z' }) as never,
      );

      expect(users.update).toHaveBeenCalledWith('u1', { deactivated_at: null });
      expect(content.visibilityChanged).toHaveBeenCalledWith('u1');
    });

    it('does nothing for an active account', async () => {
      await service.reactivate(account() as never);

      expect(users.update).not.toHaveBeenCalled();
      expect(content.visibilityChanged).not.toHaveBeenCalled();
    });
  });
});

describe('UserContentClient', () => {
  const jwt = { sign: jest.fn() };
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let client: UserContentClient;

  beforeEach(() => {
    jest.resetAllMocks();
    jwt.sign.mockReturnValue('internal-token');
    global.fetch = fetchMock as never;
    client = new UserContentClient(jwt as never);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('calls the user service directly, with a one-minute token naming the account', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await client.eraseFiles('u1');

    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', typ: 'internal' }, 60);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/internal\/accounts\/u1\/files$/);
    expect(request).toMatchObject({
      method: 'DELETE',
      headers: { authorization: 'Bearer internal-token' },
    });
  });

  it.each([
    [
      'answers with an error',
      () => Promise.resolve({ ok: false, status: 500 }),
    ],
    ['cannot be reached', () => Promise.reject(new Error('ECONNREFUSED'))],
  ])(
    'refuses to go on with a deletion when the user service %s',
    async (_case, answer) => {
      fetchMock.mockImplementation(answer);

      await expect(client.eraseFiles('u1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    },
  );

  it('never fails a sign-in or a deactivation over a cache that was not cleared', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.visibilityChanged('u1')).resolves.toBeUndefined();
  });
});

describe('AccountController', () => {
  const service = {
    changePassword: jest.fn(),
    createPassword: jest.fn(),
    deactivate: jest.fn(),
    delete: jest.fn(),
  };
  const passwordProofs = { issue: jest.fn() };
  const user = { userId: 'u1', role: 'user', sessionId: 's1' };
  let controller: AccountController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new AccountController(
      service as never,
      {} as never,
      passwordProofs as never,
      new AuthAttemptLimits(),
      {} as never,
    );
  });

  it('keeps the calling device signed in when the password changes', async () => {
    await controller.changePassword(user, {
      currentPassword: PASSWORD,
      newPassword: 'a-new-password',
    });

    expect(service.changePassword).toHaveBeenCalledWith(
      user,
      PASSWORD,
      'a-new-password',
    );
  });

  it('returns the password proof to the app', async () => {
    passwordProofs.issue.mockResolvedValue({
      proofToken: 'signed-proof',
      expiresInSeconds: 300,
    });

    await expect(
      controller.proveWithPassword(user, { password: PASSWORD }),
    ).resolves.toEqual({
      proofToken: 'signed-proof',
      expiresInSeconds: 300,
    });
  });

  it('stops guessing the password after 10 wrong tries, across every action that asks for it', async () => {
    const wrong = new ForbiddenException('The password is incorrect');
    service.changePassword.mockRejectedValue(wrong);
    service.deactivate.mockRejectedValue(wrong);
    service.delete.mockRejectedValue(wrong);
    passwordProofs.issue.mockRejectedValue(wrong);

    for (let i = 0; i < 3; i++) {
      await expect(
        controller.changePassword(user, {
          currentPassword: 'x',
          newPassword: 'y',
        }),
      ).rejects.toBe(wrong);
      await expect(controller.deactivate(user, { password: 'x' })).rejects.toBe(
        wrong,
      );
      await expect(
        controller.proveWithPassword(user, { password: 'x' }),
      ).rejects.toBe(wrong);
    }
    await expect(controller.delete(user, { password: 'x' })).rejects.toBe(
      wrong,
    );

    await expect(
      controller.delete(user, { password: PASSWORD }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(service.delete).toHaveBeenCalledTimes(1);
  });

  it('forgets earlier typos after a right answer', async () => {
    service.deactivate.mockRejectedValue(new ForbiddenException());
    for (let i = 0; i < 9; i++)
      await controller
        .deactivate(user, { password: 'typo' })
        .catch(() => undefined);

    service.changePassword.mockResolvedValue(undefined);
    await controller.changePassword(user, {
      currentPassword: PASSWORD,
      newPassword: 'a-new-password',
    });

    for (let i = 0; i < 10; i++) {
      await expect(
        controller.deactivate(user, { password: 'typo' }),
      ).rejects.toThrow(ForbiddenException);
    }
  });
});
