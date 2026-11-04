import { FirebaseLoginService } from './firebase-login.service';

// firebase-admin pulls in ESM-only packages Jest cannot load; the real
// service is replaced by a stub below anyway.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/current-photo';

describe('FirebaseLoginService', () => {
  const firebase = { verifyIdToken: jest.fn() };
  const users = {
    findByFirebaseUid: jest.fn(),
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const sessions = { endAllSessions: jest.fn() };
  const signIn = { complete: jest.fn() };
  const client = {
    deviceName: 'Pixel 8',
    platform: 'Android 15',
    ipAddress: '203.0.113.7',
  };
  let service: FirebaseLoginService;

  const existingUser = {
    id: 'u1',
    role: 'user',
    email: 'a@b.com',
    username: 'has_name',
    name: 'Has Name',
    avatar_url: 'https://storage.test/avatars/u1/own-upload',
    firebase_uid: null,
    password_hash: 'hash-of-a-password-someone-chose',
    has_password: true,
  };
  const linkedUser = { ...existingUser, firebase_uid: 'fb1' };
  const googleToken = { uid: 'fb1', email: 'a@b.com', email_verified: true };

  beforeEach(() => {
    jest.resetAllMocks();
    signIn.complete.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    service = new FirebaseLoginService(
      firebase as never,
      users as never,
      sessions as never,
      signIn as never,
    );
  });

  it('refuses an SMS confirmation: it only resets a password, never signs in', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-phone',
      phone_number: '+85512345678',
      firebase: { sign_in_provider: 'phone' },
    });

    await expect(service.login('id-token', client)).rejects.toMatchObject({
      status: 401,
    });
    expect(users.findByPhone).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(signIn.complete).not.toHaveBeenCalled();
  });

  it('signs in a user already linked to the Firebase uid', async () => {
    firebase.verifyIdToken.mockResolvedValue(googleToken);
    users.findByFirebaseUid.mockResolvedValue(linkedUser);

    const tokens = await service.login('id-token', client);

    expect(users.create).not.toHaveBeenCalled();
    expect(signIn.complete).toHaveBeenCalledWith(linkedUser, client);
    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('links a verified email to the existing account', async () => {
    firebase.verifyIdToken.mockResolvedValue(googleToken);
    users.findByFirebaseUid.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(existingUser);

    await service.login('id-token', client);

    expect(users.update).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ firebase_uid: 'fb1' }),
    );
    expect(users.create).not.toHaveBeenCalled();
  });

  it('linking discards a password nobody proved they own, and its sessions', async () => {
    firebase.verifyIdToken.mockResolvedValue(googleToken);
    users.findByFirebaseUid.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(existingUser);

    await service.login('id-token', client);

    const patch = users.update.mock.calls[0][1];
    expect(patch.password_hash).toMatch(/^\$2[aby]\$/);
    expect(patch.password_hash).not.toBe(existingUser.password_hash);
    // The app then offers "Create password" instead of asking for one that no longer works.
    expect(patch.has_password).toBe(false);
    expect(sessions.endAllSessions).toHaveBeenCalledWith('u1');
  });

  it('leaves the password alone once the account is linked', async () => {
    firebase.verifyIdToken.mockResolvedValue(googleToken);
    users.findByFirebaseUid.mockResolvedValue(linkedUser);

    await service.login('id-token', client);

    expect(users.update).not.toHaveBeenCalled();
    expect(sessions.endAllSessions).not.toHaveBeenCalled();
  });

  it('never links an account through an UNVERIFIED email', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb9',
      email: 'victim@b.com',
      email_verified: false,
    });
    users.findByFirebaseUid.mockResolvedValue(null);
    users.create.mockResolvedValue({
      ...existingUser,
      id: 'new',
      email: 'victim@b.com',
    });

    await service.login('id-token', client);

    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalledWith('u1', expect.anything());
  });

  it('creates a new account (role "user") when nobody matches', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb2',
      email: 'new@b.com',
      email_verified: true,
      name: 'New Person',
      picture: GOOGLE_PHOTO,
    });
    users.findByFirebaseUid.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({
      ...existingUser,
      id: 'u2',
      name: 'New Person',
      avatar_url: GOOGLE_PHOTO,
    });

    await service.login('id-token', client);

    const created = users.create.mock.calls[0][0];
    expect(created).toMatchObject({
      email: 'new@b.com',
      role: 'user',
      firebase_uid: 'fb2',
      name: 'New Person',
      avatar_url: GOOGLE_PHOTO,
    });
    expect(created.password_hash).toBeTruthy();
    // The Google name is what people see; the unique handle comes from the database.
    expect(created).not.toHaveProperty('username');
    // No password of its own yet: the database default says so.
    expect(created).not.toHaveProperty('has_password');
  });

  describe('name and picture from Google', () => {
    const signInWith = async (user: object, picture = GOOGLE_PHOTO) => {
      firebase.verifyIdToken.mockResolvedValue({
        ...googleToken,
        name: 'Google Name',
        picture,
      });
      users.findByFirebaseUid.mockResolvedValue(user);
      await service.login('id-token', client);
    };

    it('fills in a missing name', async () => {
      await signInWith({ ...linkedUser, name: null });

      expect(users.update).toHaveBeenCalledWith('u1', { name: 'Google Name' });
    });

    it('does not bring back a picture the user removed', async () => {
      await signInWith({ ...linkedUser, avatar_url: null });

      expect(users.update).not.toHaveBeenCalled();
    });

    it('follows the Google photo when it changes, while the picture is synced from Google', async () => {
      await signInWith({
        ...linkedUser,
        avatar_url: 'https://lh3.googleusercontent.com/a/old-photo',
      });

      expect(users.update).toHaveBeenCalledWith('u1', {
        avatar_url: GOOGLE_PHOTO,
      });
    });

    it('never replaces a name the user chose or a picture they uploaded', async () => {
      await signInWith(linkedUser);

      expect(users.update).not.toHaveBeenCalled();
    });

    it('writes nothing when the Google photo is the same', async () => {
      await signInWith({ ...linkedUser, avatar_url: GOOGLE_PHOTO });

      expect(users.update).not.toHaveBeenCalled();
    });
  });
});
