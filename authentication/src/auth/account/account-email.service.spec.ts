import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AccountEmailService } from './account-email.service';

// firebase-admin (reached through IdentityProofService) pulls in ESM-only packages Jest cannot load.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('AccountEmailService', () => {
  const users = { findByEmail: jest.fn(), update: jest.fn() };
  const devices = { require: jest.fn() };
  const proofs = { verify: jest.fn() };
  const caller = { userId: 'u1', sessionId: 's1' };
  let service: AccountEmailService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AccountEmailService(
      users as never,
      devices as never,
      proofs as never,
      { requireProof: jest.fn() } as never,
    );
    proofs.verify.mockResolvedValue({ id: 'u1', email: null });
    users.findByEmail.mockResolvedValue(null);
  });

  it('adds the email once the password is confirmed', async () => {
    await service.addEmail(caller, 'a@b.com', 'pw', 'email-proof');

    expect(proofs.verify).toHaveBeenCalledWith('u1', { password: 'pw' });
    expect(users.update).toHaveBeenCalledWith('u1', {
      email: 'a@b.com',
      email_verified: true,
    });
  });

  it('is refused on a device signed in less than a day ago, before the password is checked', async () => {
    devices.require.mockRejectedValue(new ForbiddenException());

    await expect(
      service.addEmail(caller, 'a@b.com', 'pw', 'email-proof'),
    ).rejects.toThrow(ForbiddenException);
    expect(proofs.verify).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('changes nothing for a wrong password', async () => {
    proofs.verify.mockRejectedValue(new ForbiddenException());

    await expect(
      service.addEmail(caller, 'a@b.com', 'nope', 'email-proof'),
    ).rejects.toThrow(ForbiddenException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('never replaces an email the account already has', async () => {
    proofs.verify.mockResolvedValue({ id: 'u1', email: 'old@b.com' });

    await expect(
      service.addEmail(caller, 'a@b.com', 'pw', 'email-proof'),
    ).rejects.toThrow(ConflictException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses an email another account uses', async () => {
    users.findByEmail.mockResolvedValue({ id: 'u2' });

    await expect(
      service.addEmail(caller, 'a@b.com', 'pw', 'email-proof'),
    ).rejects.toThrow(ConflictException);
    expect(users.update).not.toHaveBeenCalled();
  });
});
