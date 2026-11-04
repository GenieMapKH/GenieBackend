import { inLocale, texts } from '../delivery/notification-texts';
import { PushContent, PushTarget } from '../delivery/push-sender';

/** A message was stored for someone. Its text is end-to-end encrypted: the server cannot show it. */
export interface ChatMessageEvent {
  recipientId: string;
  senderId: string;
  senderName: string;
  messageId: string;
  /** The sealed message, as stored. Only the recipient's phone can open it. */
  ciphertext?: string;
  nonce?: string;
}

/**
 * Firebase accepts 4096 bytes of data in a push. Leave room for the rest of
 * it (ids, name, field names); a longer message is announced without its text.
 */
export const MAX_SEALED_PUSH_LENGTH = 3000;

/**
 * "Dara · New message". One notification per sender: a newer message from
 * the same person replaces the previous one instead of piling up.
 *
 * Every device gets this generic notification, shown by the system even
 * when the app is closed. Android also gets the sealed message with it: when
 * the app can start, it opens it with the keys on the phone and replaces the
 * notification (same tag) with one showing the text. The server never reads
 * the text, and Google only carries what the server stores anyway.
 */
export function chatMessagePush(
  event: ChatMessageEvent,
  target: PushTarget,
): PushContent {
  const common = {
    channel: 'chat_messages' as const,
    tag: `chat:${event.senderId}`,
    urgent: true,
    alert: {
      title: event.senderName,
      body: inLocale(texts.newMessage, target.locale),
    },
  };
  const data = {
    type: 'chat_message',
    senderId: event.senderId,
    senderName: event.senderName,
    messageId: event.messageId,
  };

  if (
    target.platform === 'android' &&
    event.ciphertext &&
    event.nonce &&
    fitsInPush(event.ciphertext, event.nonce)
  ) {
    return {
      ...common,
      data: {
        ...data,
        recipientId: event.recipientId,
        ciphertext: event.ciphertext,
        nonce: event.nonce,
      },
    };
  }
  return { ...common, data };
}

function fitsInPush(ciphertext: string, nonce: string): boolean {
  return ciphertext.length + nonce.length <= MAX_SEALED_PUSH_LENGTH;
}
