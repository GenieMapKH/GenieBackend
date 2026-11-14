import { ForbiddenException } from '@nestjs/common';
import { AccountPhoneService } from './account-phone.service';
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

describe('contact phone changes', () => {
  const users = {
    findById: jest.fn(),
    findByPhone: jest.fn(),
    update: jest.fn(),
    verifyPhone: jest.fn(),
  };
  const devices = { require: jest.fn() };
  const identities = { verify: jest.fn() };
  const sessions = { endAllSessions: jest.fn() };
  const phones = { requireProof: jest.fn() };
  const caller = { userId: 'owner', sessionId: 'old-device' };
  const service = new AccountPhoneService(
    users as never,
    devices as never,
    identities as never,
    sessions as never,
    phones as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    users.findById.mockResolvedValue({ id: 'owner', phone: null });
    identities.verify.mockResolvedValue({ id: 'owner', phone: '+85512345678' });
  });

  it('verifies the first phone of an OAuth account without waiting a day', async () => {
    await service.verify(caller, '+85512345678', 'sms-proof');
    expect(phones.requireProof).toHaveBeenCalledWith(
      '+85512345678',
      'sms-proof',
    );
    expect(users.verifyPhone).toHaveBeenCalledWith(
      'owner',
      null,
      '+85512345678',
    );
    expect(devices.require).not.toHaveBeenCalled();
    expect(identities.verify).not.toHaveBeenCalled();
  });

  it('verifies the existing number of a legacy account', async () => {
    users.findById.mockResolvedValue({ id: 'owner', phone: '012 345 678' });
    await service.verify(caller, '+85512345678', 'sms-proof');
    expect(users.verifyPhone).toHaveBeenCalledWith(
      'owner',
      '012 345 678',
      '+85512345678',
    );
  });

  it('does not verify a phone when the SMS proof fails', async () => {
    phones.requireProof.mockRejectedValue(new Error('invalid proof'));
    await expect(
      service.verify(caller, '+85512345678', 'bad-proof'),
    ).rejects.toThrow();
    expect(users.update).not.toHaveBeenCalled();
    expect(users.verifyPhone).not.toHaveBeenCalled();
  });

  it('never bypasses protected phone changes through SMS verification', async () => {
    users.findById.mockResolvedValue({
      id: 'owner',
      phone: '+85598765432',
      phone_verified: true,
    });
    await expect(
      service.verify(caller, '+85512345678', 'sms-proof'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'PHONE_CHANGE_REQUIRED' },
    });
    expect(phones.requireProof).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(users.verifyPhone).not.toHaveBeenCalled();
  });

  it('never verifies a phone already assigned to another account', async () => {
    users.findByPhone.mockResolvedValue({ id: 'other' });
    await expect(
      service.verify(caller, '+85512345678', 'sms-proof'),
    ).rejects.toMatchObject({ status: 409 });
    expect(users.update).not.toHaveBeenCalled();
    expect(users.verifyPhone).not.toHaveBeenCalled();
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
      expect(users.verifyPhone).not.toHaveBeenCalled();
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
    expect(users.verifyPhone).not.toHaveBeenCalled();
  });
});
