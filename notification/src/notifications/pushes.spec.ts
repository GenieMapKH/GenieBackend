import {
  callEndedPush,
  incomingCallPush,
  RING_SECONDS,
} from './calls/call.push';
import {
  chatMessagePush,
  MAX_SEALED_PUSH_LENGTH,
} from './chat/chat-message.push';
import { toFirebaseMessage } from './delivery/firebase-push-sender';
import { PushTarget } from './delivery/push-sender';
import { promotionPush } from './promotions/promotion.push';
import { signInAlertPush } from './security/sign-in-alert.push';

const device = (
  platform: PushTarget['platform'],
  locale: PushTarget['locale'] = 'en',
): PushTarget => ({
  id: `d-${platform}-${locale}`,
  token: `token-${platform}`,
  platform,
  locale,
});

const call = {
  callId: 'c1',
  callerId: 'alice',
  callerName: 'Alice',
  calleeId: 'bob',
};

describe('what each push says', () => {
  it('a chat message names the sender but never its text, one per sender', () => {
    const push = chatMessagePush(
      {
        recipientId: 'bob',
        senderId: 'alice',
        senderName: 'Alice',
        messageId: 'm1',
      },
      device('android', 'km'),
    );

    expect(push.alert).toEqual({ title: 'Alice', body: 'សារថ្មី' });
    expect(push.data).toEqual({
      type: 'chat_message',
      senderId: 'alice',
      senderName: 'Alice',
      messageId: 'm1',
    });
    expect(push.tag).toBe('chat:alice');
    expect(push.channel).toBe('chat_messages');
  });

  describe('a chat message with its sealed text', () => {
    const sealed = { ciphertext: 'c'.repeat(100), nonce: 'n'.repeat(32) };
    const event = {
      recipientId: 'bob',
      senderId: 'alice',
      senderName: 'Alice',
      messageId: 'm1',
      ...sealed,
    };

    it('goes to Android with the generic notification, shown even when the app is closed, and the sealed text for the app to replace it', () => {
      const push = chatMessagePush(event, device('android'));

      expect(push.alert).toEqual({ title: 'Alice', body: 'New message' });
      expect(push.data).toEqual({
        type: 'chat_message',
        senderId: 'alice',
        senderName: 'Alice',
        messageId: 'm1',
        recipientId: 'bob',
        ...sealed,
      });
      expect(push.urgent).toBe(true);
      expect(push.tag).toBe('chat:alice');
    });

    it('is only the generic notification on iOS and in browsers, which cannot open it', () => {
      for (const platform of ['ios', 'web'] as const) {
        const push = chatMessagePush(event, device(platform));

        expect(push.alert).toEqual({ title: 'Alice', body: 'New message' });
        expect(push.data).not.toHaveProperty('ciphertext');
      }
    });

    it('is the generic notification when the message is too long to fit in a push', () => {
      const long = { ...event, ciphertext: 'c'.repeat(MAX_SEALED_PUSH_LENGTH) };

      const push = chatMessagePush(long, device('android'));

      expect(push.alert).toEqual({ title: 'Alice', body: 'New message' });
      expect(JSON.stringify(push.data).length).toBeLessThan(500);
    });

    it('stays within what Firebase accepts at the largest size it attaches', () => {
      const biggest = {
        ...event,
        ciphertext: 'c'.repeat(MAX_SEALED_PUSH_LENGTH - 32),
      };

      const message = toFirebaseMessage(
        't',
        chatMessagePush(biggest, device('android')),
      );

      // Firebase's limit counts the notification along with the data.
      expect(
        Buffer.byteLength(
          JSON.stringify({ data: message.data, n: message.notification }),
        ),
      ).toBeLessThan(4096);
      expect(message.android?.notification?.tag).toBe('chat:alice');
      expect(message.android?.priority).toBe('high');
    });

    it('is the generic notification when the chat service sent no sealed text', () => {
      const push = chatMessagePush(
        { ...event, ciphertext: undefined },
        device('android'),
      );

      expect(push.alert).toEqual({ title: 'Alice', body: 'New message' });
    });
  });

  it('a sign-in alert names the device that signed in', () => {
    const push = signInAlertPush(
      {
        userId: 'u',
        sessionId: 's2',
        deviceName: 'Pixel 8',
        platform: 'Android 15',
      },
      device('ios'),
    );

    expect(push.alert!.title).toBe('New sign-in to your account');
    expect(push.alert!.body).toMatch(/^Pixel 8 \(Android 15\) signed in\./);
    expect(push.data).toEqual({ type: 'security_sign_in', sessionId: 's2' });
  });

  it('a sign-in alert from an unnamed device still reads well', () => {
    const push = signInAlertPush(
      { userId: 'u', sessionId: 's2' },
      device('web', 'km'),
    );

    expect(push.alert!.body.startsWith('ឧបករណ៍ថ្មីមួយ')).toBe(true);
  });

  it('wakes the Android call handler with data only; other devices receive an alert', () => {
    const android = incomingCallPush(call, device('android'));
    const ios = incomingCallPush(call, device('ios'));

    expect(android.alert).toBeUndefined();
    const message = toFirebaseMessage('android-token', android);
    expect(message.notification).toBeUndefined();
    expect(message.android!.notification).toBeUndefined();
    expect(message.android!.priority).toBe('high');
    expect(message.android!.ttl).toBe(RING_SECONDS * 1000);
    expect(android.tag).toBe('call:c1');
    expect(android.channel).toBe('calls');
    expect(android.data).toMatchObject({
      type: 'call_incoming',
      callId: 'c1',
      callerName: 'Alice',
    });
    expect(ios.alert).toEqual({
      title: 'Alice is calling',
      body: 'Tap to answer',
    });
    expect(android.timeToLiveSeconds).toBe(RING_SECONDS);
    expect(android.urgent).toBe(true);
  });

  it('an ended call stops Android ringing; a missed one is told everywhere, quietly, in place of the ringing one', () => {
    const answered = callEndedPush(
      { ...call, missed: false },
      device('android'),
    )!;
    expect(answered.data.type).toBe('call_ended');
    expect(answered.alert).toBeUndefined();

    const missed = callEndedPush({ ...call, missed: true }, device('android'))!;
    // Ending must also reach the handler immediately, to silence the ringtone.
    expect(missed.alert).toBeUndefined();
    expect(missed.channel).toBe('missed_calls');
    expect(missed.tag).toBe('call:c1');
    expect(missed.urgent).toBe(true);

    expect(callEndedPush({ ...call, missed: false }, device('web'))).toBeNull();
    expect(
      callEndedPush({ ...call, missed: true }, device('web'))!.alert,
    ).toEqual({
      title: 'Missed call',
      body: 'Alice called you',
    });
  });

  it('a promotion is in Khmer where it was written in Khmer, else English', () => {
    const promotion = {
      id: 'p1',
      title: 'Big sale',
      body: 'Half off',
      titleKm: 'លក់ធំ',
      bodyKm: null,
      propertyId: 'prop-1',
      url: null,
      imageUrl: 'https://img.example/a.png',
    };

    const khmer = promotionPush(promotion, device('android', 'km'));
    const english = promotionPush(promotion, device('android', 'en'));

    expect(khmer.alert).toEqual({
      title: 'លក់ធំ',
      body: 'Half off',
      imageUrl: 'https://img.example/a.png',
    });
    expect(english.alert!.title).toBe('Big sale');
    expect(khmer.data).toEqual({
      type: 'promotion',
      promotionId: 'p1',
      propertyId: 'prop-1',
    });
    expect(khmer.urgent).toBe(false);
  });
});

describe('the Firebase message', () => {
  it('shows a visible push on every kind of device, on its Android channel', () => {
    const message = toFirebaseMessage('t', {
      alert: { title: 'Hi', body: 'There' },
      data: { type: 'x' },
      channel: 'chat_messages',
      tag: 'chat:a',
      urgent: true,
    });

    expect(message.notification).toEqual({
      title: 'Hi',
      body: 'There',
      imageUrl: undefined,
    });
    expect(message.android).toMatchObject({
      priority: 'high',
      collapseKey: 'chat:a',
      notification: { channelId: 'chat_messages', tag: 'chat:a' },
    });
    expect(message.apns!.headers).toMatchObject({
      'apns-priority': '10',
      'apns-collapse-id': 'chat:a',
    });
    expect(message.webpush!.notification).toMatchObject({
      title: 'Hi',
      body: 'There',
    });
  });

  it('a silent push wakes the app instead, and expires when asked', () => {
    const message = toFirebaseMessage('t', {
      data: { type: 'call_incoming' },
      channel: 'calls',
      urgent: true,
      timeToLiveSeconds: 45,
    });

    expect(message.notification).toBeUndefined();
    expect(message.android!.notification).toBeUndefined();
    expect(message.android!.ttl).toBe(45000);
    expect(message.apns!.payload!.aps).toEqual({ contentAvailable: true });
    expect(message.webpush!.headers).toMatchObject({ TTL: '45' });
  });
});
