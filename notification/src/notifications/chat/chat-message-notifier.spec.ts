import { Logger } from '@nestjs/common';
import { ChatMessageNotifier } from './chat-message-notifier';

const event = {
  recipientId: 'bob',
  senderId: 'alice',
  senderName: 'Alice',
  messageId: 'm1',
};
const phone = {
  id: 'd1',
  token: 't1',
  platform: 'android' as const,
  locale: 'en' as const,
};

describe('ChatMessageNotifier', () => {
  const preferences = { get: jest.fn() };
  const devices = { targetsOf: jest.fn() };
  const delivery = { deliver: jest.fn() };
  let notifier: ChatMessageNotifier;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    preferences.get.mockResolvedValue({ chatMessages: true });
    devices.targetsOf.mockResolvedValue([phone]);
    delivery.deliver.mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
    notifier = new ChatMessageNotifier(
      preferences as never,
      devices as never,
      delivery as never,
    );
  });

  it('sends a push to every device and logs how it went', async () => {
    const report = await notifier.notify(event);

    expect(report).toEqual({ sent: 1, failed: 0, removed: 0 });
    const content = delivery.deliver.mock.calls[0][1](phone);
    expect(content.alert).toEqual({ title: 'Alice', body: 'New message' });
    expect(log).toHaveBeenCalledWith(
      'Chat push for bob: 1 device(s), sent 1, failed 0, removed 0',
    );
  });

  it('says so when the account has no registered device', async () => {
    devices.targetsOf.mockResolvedValue([]);

    expect(await notifier.notify(event)).toEqual({
      sent: 0,
      failed: 0,
      removed: 0,
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no device is registered'),
    );
  });

  it('says so when the account turned chat notifications off', async () => {
    preferences.get.mockResolvedValue({ chatMessages: false });

    await notifier.notify(event);

    expect(devices.targetsOf).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('turned off'));
  });

  it('logs failures and removed devices', async () => {
    delivery.deliver.mockResolvedValue({ sent: 0, failed: 1, removed: 1 });

    await notifier.notify(event);

    expect(log).toHaveBeenCalledWith(
      'Chat push for bob: 1 device(s), sent 0, failed 1, removed 1',
    );
  });

  it('never notifies someone about their own message', async () => {
    await notifier.notify({ ...event, recipientId: 'alice' });

    expect(devices.targetsOf).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
