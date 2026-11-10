import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';

/** Lets the code-issuing work that runs after the reply finish. */
const flushBackgroundWork = () =>
  new Promise((resolve) => setImmediate(resolve));

describe('PasswordResetService', () => {
  const users = { findByEmail: jest.fn(), update: jest.fn() };
  const otps = {
    invalidateAllFor: jest.fn(),
    create: jest.fn(),
    findLatestActive: jest.fn(),
    claim: jest.fn(),
  };
  const sessions = { endAllSessions: jest.fn() };
  const mailer = { sendOtp: jest.fn() };
  let service: PasswordResetService;

  beforeEach(() => {
    jest.resetAllMocks();
    mailer.sendOtp.mockResolvedValue(undefined);
    otps.claim.mockResolvedValue(true);
    service = new PasswordResetService(
      users as never,
      otps as never,
      sessions as never,
      mailer as never,
    );
  });

  describe('requestReset', () => {
    it('gives the same answer for unknown emails and sends nothing', async () => {
      users.findByEmail.mockResolvedValue(null);

      const result = await service.requestReset('ghost@example.com');
      await flushBackgroundWork();

      expect(result.message).toMatch(/If the email exists/);
      expect(mailer.sendOtp).not.toHaveBeenCalled();
      expect(otps.create).not.toHaveBeenCalled();
    });

    it('stores only a hash of a 6-digit code and emails the code', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', email_verified: true });

      await service.requestReset('a@b.com');
      await flushBackgroundWork();

      const [email, otp] = mailer.sendOtp.mock.calls[0];
      expect(email).toBe('a@b.com');
      expect(otp).toMatch(/^\d{6}$/);

      const [, storedHash] = otps.create.mock.calls[0];
      expect(storedHash).not.toBe(otp);
      expect(await bcrypt.compare(otp, storedHash)).toBe(true);
      expect(otps.invalidateAllFor).toHaveBeenCalledWith('a@b.com');
    });

    it('still succeeds when the email provider fails', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', email_verified: true });
      mailer.sendOtp.mockRejectedValue(new Error('smtp down'));

      await expect(service.requestReset('a@b.com')).resolves.toBeDefined();
      await flushBackgroundWork();
    });

    it('answers before storing or sending anything, so the reply takes as long either way', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', email_verified: true });
      let finishStoring!: () => void;
      otps.invalidateAllFor.mockReturnValue(
        new Promise<void>((resolve) => (finishStoring = resolve)),
      );

      await service.requestReset('a@b.com');

      expect(mailer.sendOtp).not.toHaveBeenCalled();
      finishStoring();
      await flushBackgroundWork();
      expect(mailer.sendOtp).toHaveBeenCalled();
    });
  });

  describe('verifyOtp / resetPassword', () => {
    const record = { id: 'o1', otp_hash: bcrypt.hashSync('123456', 4) };

    it('accepts the right code', async () => {
      otps.findLatestActive.mockResolvedValue(record);

      await expect(
        service.verifyOtp('a@b.com', '123456'),
      ).resolves.toMatchObject({ verified: true });
    });

    it('rejects a wrong code and an expired/missing one', async () => {
      otps.findLatestActive.mockResolvedValueOnce(record);
      await expect(service.verifyOtp('a@b.com', '000000')).rejects.toThrow(
        BadRequestException,
      );

      otps.findLatestActive.mockResolvedValueOnce(null);
      await expect(service.verifyOtp('a@b.com', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('changes the password, burns the code and signs the user out everywhere', async () => {
      otps.findLatestActive.mockResolvedValue(record);
      users.findByEmail.mockResolvedValue({ id: 'u1', email_verified: true });

      await service.resetPassword('a@b.com', '123456', 'new-password');

      const patch = users.update.mock.calls[0][1];
      expect(await bcrypt.compare('new-password', patch.password_hash)).toBe(
        true,
      );
      // Also how a Google account ends up with a password of its own.
      expect(patch.has_password).toBe(true);
      expect(otps.claim).toHaveBeenCalledWith('o1');
      expect(sessions.endAllSessions).toHaveBeenCalledWith('u1');
    });

    it('lets only one of two resets sent at once with the same code through', async () => {
      otps.findLatestActive.mockResolvedValue(record);
      users.findByEmail.mockResolvedValue({ id: 'u1', email_verified: true });
      otps.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const results = await Promise.allSettled([
        service.resetPassword('a@b.com', '123456', 'first-password'),
        service.resetPassword('a@b.com', '123456', 'second-password'),
      ]);

      // Whichever claims the code first wins; the other is refused.
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(users.update).toHaveBeenCalledTimes(1);
    });

    it('does not touch the password when the code is wrong', async () => {
      otps.findLatestActive.mockResolvedValue(record);

      await expect(
        service.resetPassword('a@b.com', '999999', 'new-password'),
      ).rejects.toThrow(BadRequestException);
      expect(users.update).not.toHaveBeenCalled();
    });
  });
});
