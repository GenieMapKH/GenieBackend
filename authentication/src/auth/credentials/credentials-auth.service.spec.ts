import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CredentialsAuthService } from './credentials-auth.service';

// firebase-admin (reached through SignInService) pulls in ESM-only packages Jest cannot load.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('CredentialsAuthService', () => {
  const users = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
  };
  const signIn = { complete: jest.fn() };
  const adminLogin = { start: jest.fn() };
  const emails = { requireProof: jest.fn() };
  const phones = { verify: jest.fn() };
  const client = {
    deviceName: 'Pixel 8',
    platform: 'Android 15',
    ipAddress: '203.0.113.7',
  };
  let service: CredentialsAuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    phones.verify.mockResolvedValue('+85512345678');
    service = new CredentialsAuthService(
      users as never,
      signIn as never,
      emails as never,
      phones as never,
      adminLogin as never,
    );
  });

  describe('register', () => {
    it('registers without SMS and leaves the phone unverified', async () => {
      await service.register({
        phone: '+85512345678',
        password: 'password123',
      });

      expect(phones.verify).not.toHaveBeenCalled();
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+85512345678',
          phone_verified: false,
          email_verified: false,
        }),
      );
    });

    it('still requires proof for an optional email without SMS', async () => {
      emails.requireProof.mockImplementationOnce(() => {
        throw new BadRequestException();
      });
      await expect(
        service.register({
          phone: '+85512345678',
          email: 'victim@example.test',
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('cannot create an account with an unproven email or a mismatched SMS proof', async () => {
      emails.requireProof.mockImplementationOnce(() => {
        throw new BadRequestException();
      });
      await expect(
        service.register({
          phone: '+85512345678',
          phoneToken: 'sms',
          email: 'victim@example.test',
          password: 'password123',
        }),
      ).rejects.toThrow();
      phones.verify.mockResolvedValueOnce('+85512999999');
      await expect(
        service.register({
          phone: '+85512345678',
          phoneToken: 'sms',
          password: 'password123',
        }),
      ).rejects.toThrow();
      expect(users.create).not.toHaveBeenCalled();
    });
    it('hashes the password and always creates a plain "user"', async () => {
      await service.register({
        phone: '+85512345678',
        phoneToken: 'sms-proof',
        password: 'password123',
      });

      const saved = users.create.mock.calls[0][0];
      expect(saved).toMatchObject({
        phone: '+85512345678',
        email: null,
        name: null,
      });
      expect(saved.role).toBe('user');
      expect(saved.password_hash).not.toBe('password123');
      expect(await bcrypt.compare('password123', saved.password_hash)).toBe(
        true,
      );
      // Unlike an account made by Google sign-in, this one has a password to prove itself with.
      expect(saved.has_password).toBe(true);
      expect(saved.phone_verified).toBe(true);
    });

    it('refuses an email that an existing account already uses, in any letter case', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', email: 'Foo@Gmail.com' });

      await expect(
        service.register({
          phone: '+85512345678',
          phoneToken: 'sms-proof',
          email: 'foo@gmail.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Email or phone already exists');
      expect(users.create).not.toHaveBeenCalled();
    });

    it('refuses a phone number an existing account has, in any stored spelling', async () => {
      users.findByPhone.mockResolvedValue({ id: 'u1', phone: '012345678' });

      await expect(
        service.register({
          phone: '+85512345678',
          phoneToken: 'sms-proof',
          password: 'password123',
        }),
      ).rejects.toThrow('Email or phone already exists');
      expect(users.findByPhone).toHaveBeenCalledWith('+85512345678');
      expect(users.create).not.toHaveBeenCalled();
    });

    it('saves the optional email and name when given', async () => {
      await service.register({
        phone: '+85512345678',
        phoneToken: 'sms-proof',
        email: 'a@b.com',
        name: 'Dara',
        password: 'password123',
      });

      expect(users.create.mock.calls[0][0]).toMatchObject({
        phone: '+85512345678',
        email: 'a@b.com',
        name: 'Dara',
      });
    });

    it('ignores a role sent by the client', async () => {
      await service.register({
        phone: '+85512345678',
        phoneToken: 'sms-proof',
        password: 'password123',
        role: 'admin',
      } as never);

      expect(users.create.mock.calls[0][0].role).toBe('user');
    });
  });

  describe('login', () => {
    const passwordHash = bcrypt.hashSync('correct-password', 4);

    it('requires an email link after the admin password, and never starts a session', async () => {
      const admin = {
        id: 'admin-1',
        role: 'admin',
        email_verified: true,
        password_hash: passwordHash,
      };
      users.findByEmail.mockResolvedValue(admin);
      adminLogin.start.mockResolvedValue({ status: 'admin_email_required' });
      await expect(
        service.login(
          { email: 'owner@example.com', password: 'correct-password' },
          client,
        ),
      ).resolves.toEqual({
        status: 'admin_email_required',
      });
      expect(adminLogin.start).toHaveBeenCalledWith(admin);
      expect(signIn.complete).not.toHaveBeenCalled();
      await expect(
        service.login(
          { email: 'owner@example.com', password: 'wrong-password' },
          client,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(adminLogin.start).toHaveBeenCalledTimes(1);
      expect(signIn.complete).not.toHaveBeenCalled();
    });

    it('signs the user in for the right password', async () => {
      const user = { id: 'u1', role: 'user', password_hash: passwordHash };
      users.findByEmail.mockResolvedValue(user);
      signIn.complete.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
      });

      const result = await service.login(
        { email: 'a@b.com', password: 'correct-password' },
        client,
      );

      expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
      expect(signIn.complete).toHaveBeenCalledWith(user, client);
    });

    it('answers a wrong password and an unknown user identically, and signs nobody in', async () => {
      users.findByEmail.mockResolvedValueOnce({
        id: 'u1',
        role: 'user',
        password_hash: passwordHash,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'nope' }, client),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

      users.findByEmail.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'x@y.com', password: 'nope' }, client),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
      expect(signIn.complete).not.toHaveBeenCalled();
    });

    it('looks the user up by phone when no email is given', async () => {
      users.findByPhone.mockResolvedValue(null);

      await expect(
        service.login({ phone: '+855123', password: 'x' }, client),
      ).rejects.toThrow(UnauthorizedException);
      expect(users.findByPhone).toHaveBeenCalledWith('+855123');
    });

    it('refuses a login with neither email nor phone', async () => {
      await expect(service.login({ password: 'x' }, client)).rejects.toThrow(
        BadRequestException,
      );
      expect(users.findByEmail).not.toHaveBeenCalled();
    });
  });
});
