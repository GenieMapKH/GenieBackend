import { currentServiceMessage, ServiceClient } from '@tilomnov/shared';
import { ExpiryReminderNotifier } from './expiry-reminder-notifier';

jest.mock('@tilomnov/shared', () => ({
  ...jest.requireActual('@tilomnov/shared'),
  currentServiceMessage: jest.fn(),
}));

describe('delayed expiry reminder delivery', () => {
  const devices = { targetsOf: jest.fn().mockResolvedValue([]) };
  const delivery = {
    deliver: jest.fn().mockResolvedValue({ sent: 0, failed: 0, removed: 0 }),
  };
  const event = {
    userId: '11111111-1111-4111-8111-111111111111',
    kind: 'subscription' as const,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  let check: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    (currentServiceMessage as jest.Mock).mockReturnValue({ id: 'queued' });
    check = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockResolvedValue({ current: true });
  });
  afterEach(() => check.mockRestore());
  it('confirms the payment period before sending a delayed reminder', async () => {
    await new ExpiryReminderNotifier(
      devices as never,
      delivery as never,
    ).notify(event);
    expect(check).toHaveBeenCalledWith(
      'POST',
      '/internal/publishing-reminders/current',
      { body: event, timeoutMs: 5000 },
    );
    expect(delivery.deliver).toHaveBeenCalled();
  });
  it('suppresses a reminder for a period that was renewed in the meantime', async () => {
    check.mockResolvedValue({ current: false });
    await new ExpiryReminderNotifier(
      devices as never,
      delivery as never,
    ).notify(event);
    expect(devices.targetsOf).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
  it('leaves the queue job retryable when the ledger cannot be checked', async () => {
    check.mockRejectedValue(new Error('payment unavailable'));
    await expect(
      new ExpiryReminderNotifier(devices as never, delivery as never).notify(
        event,
      ),
    ).rejects.toThrow('payment unavailable');
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});
