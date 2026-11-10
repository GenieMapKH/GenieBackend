import { CallNotifier } from './calls/call-notifier';
import { ChatMessageNotifier } from './chat/chat-message-notifier';
import { PushContent, PushTarget } from './delivery/push-sender';
import { SignInAlertNotifier } from './security/sign-in-alert-notifier';

const phone: PushTarget = {
  id: 'd1',
  token: 't1',
  platform: 'android',
  locale: 'en',
};

describe('who gets told', () => {
  const devices = { targetsOf: jest.fn() };
  const preferences = { get: jest.fn() };
  const pushes: PushContent[] = [];
  const delivery = {
    deliver: jest.fn(
      (
        targets: PushTarget[],
        contentFor: (t: PushTarget) => PushContent | null,
      ) => {
        for (const target of targets) {
          const content = contentFor(target);
          if (content) pushes.push(content);
        }
        return Promise.resolve({ sent: pushes.length, failed: 0, removed: 0 });
      },
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pushes.length = 0;
    devices.targetsOf.mockResolvedValue([phone]);
    preferences.get.mockResolvedValue({ chatMessages: true, promotions: true });
  });

  describe('a chat message', () => {
    const notifier = () =>
      new ChatMessageNotifier(
        preferences as never,
        devices as never,
        delivery as never,
      );
    const event = {
      recipientId: 'bob',
      senderId: 'alice',
      senderName: 'Alice',
      messageId: 'm1',
    };

    it('reaches every device of the recipient', async () => {
      const report = await notifier().notify(event);

      expect(devices.targetsOf).toHaveBeenCalledWith('bob');
      expect(report.sent).toBe(1);
      expect(pushes[0].data.type).toBe('chat_message');
    });

    it('is not sent to someone who turned chat notifications off', async () => {
      preferences.get.mockResolvedValue({
        chatMessages: false,
        promotions: true,
      });

      const report = await notifier().notify(event);

      expect(report.sent).toBe(0);
      expect(delivery.deliver).not.toHaveBeenCalled();
    });

    it('is never sent for a message to oneself', async () => {
      await notifier().notify({ ...event, recipientId: 'alice' });

      expect(delivery.deliver).not.toHaveBeenCalled();
    });
  });

  it('a new sign-in warns the other devices, not the one that signed in', async () => {
    const notifier = new SignInAlertNotifier(
      devices as never,
      delivery as never,
    );

    await notifier.notify({
      userId: 'bob',
      sessionId: 's-new',
      deviceName: 'Pixel',
      platform: 'Android 15',
    });

    expect(devices.targetsOf).toHaveBeenCalledWith('bob', {
      exceptSessionId: 's-new',
    });
    expect(pushes[0].data).toEqual({
      type: 'security_sign_in',
      sessionId: 's-new',
    });
  });

  it('a sign-in alert is sent even with every optional notification off', async () => {
    preferences.get.mockResolvedValue({
      chatMessages: false,
      promotions: false,
    });
    const notifier = new SignInAlertNotifier(
      devices as never,
      delivery as never,
    );

    const report = await notifier.notify({ userId: 'bob', sessionId: 's-new' });

    expect(report.sent).toBe(1);
  });

  it('a call rings the callee, then stops ringing', async () => {
    const notifier = new CallNotifier(devices as never, delivery as never);
    const call = {
      callId: 'c1',
      callerId: 'alice',
      callerName: 'Alice',
      calleeId: 'bob',
    };

    await notifier.ringing(call);
    await notifier.ended({ ...call, missed: true });

    expect(devices.targetsOf).toHaveBeenCalledWith('bob');
    expect(pushes.map((push) => push.data.type)).toEqual([
      'call_incoming',
      'call_ended',
    ]);
  });
});
