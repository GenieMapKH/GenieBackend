import { ForbiddenException } from '@nestjs/common';
import { AccountPhoneService } from './account-phone.service';
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('contact phone changes', () => {
  const users = { findByPhone: jest.fn(), update: jest.fn() };
  const devices = { require: jest.fn() };
  const identities = { verify: jest.fn() };
  const sessions = { endAllSessions: jest.fn() };
  const caller = { userId: 'owner', sessionId: 'old-device' };
  const service = new AccountPhoneService(
    users as never,
    devices as never,
    identities as never,
    sessions as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    identities.verify.mockResolvedValue({ id: 'owner', phone: '+85512345678' });
  });

  it('requires identity and an established device before changing the number, then ends other sessions', async () => {
    await service.change(caller, '+85512999999', { password: 'current' });
    expect(devices.require).toHaveBeenCalledWith(caller);
    expect(users.update).toHaveBeenCalledWith('owner', {
      phone: '+85512999999',
      phone_verified: false,
    });
    expect(sessions.endAllSessions).toHaveBeenCalledWith('owner', 'old-device');
  });

  it.each(['identity', 'device'])(
    'a rejected %s proof never changes recovery details',
    async (failure) => {
      if (failure === 'identity')
        identities.verify.mockRejectedValue(new ForbiddenException());
      if (failure === 'device')
        devices.require.mockRejectedValue(new ForbiddenException());
      await expect(
        service.change(caller, '+85512999999', { password: 'wrong' }),
      ).rejects.toThrow();
      expect(users.update).not.toHaveBeenCalled();
      expect(sessions.endAllSessions).not.toHaveBeenCalled();
    },
  );

  it('can save the existing number without claiming ownership without replacing it or signing devices out', async () => {
    users.findByPhone.mockResolvedValue({ id: 'owner' });
    await service.change(caller, '+85512345678', { password: 'current' });
    expect(devices.require).not.toHaveBeenCalled();
    expect(users.update).toHaveBeenCalledWith('owner', {
      phone: '+85512345678',
      phone_verified: false,
    });
    expect(sessions.endAllSessions).not.toHaveBeenCalled();
  });

  it('never takes a number already owned by another account', async () => {
    users.findByPhone.mockResolvedValue({ id: 'someone-else' });
    await expect(
      service.change(caller, '+85512999999', { password: 'current' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(users.update).not.toHaveBeenCalled();
  });
});
