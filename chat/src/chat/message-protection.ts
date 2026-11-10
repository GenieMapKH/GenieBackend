import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';

export const MANAGED_MESSAGE = 'managed-v1';
const STORED_MESSAGE = 'managed-stored-v1';
type MessageBody = { ciphertext: string; nonce: string };
type Parties = { id: string; senderId: string; recipientId: string };

/** New messages use TLS in transit and authenticated encryption outside the database. */
@Injectable()
export class MessageProtection {
  private key?: Buffer;

  private encryptionKey(): Buffer {
    if (this.key) return this.key;
    const secret = process.env.CHAT_MESSAGE_SECRET;
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'Message storage encryption is not configured',
      );
    }
    return (this.key = Buffer.from(
      hkdfSync('sha256', secret, Buffer.alloc(0), 'tilomnov-messages-v1', 32),
    ));
  }

  seal(body: MessageBody, parties: Parties): MessageBody {
    if (body.nonce !== MANAGED_MESSAGE) {
      throw new BadRequestException('Update the app to send messages');
    }
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(body.ciphertext, 'base64').toString('utf8'),
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid envelope');
      }
      const envelope = parsed as Record<string, unknown>;
      if (
        envelope.v !== 1 ||
        typeof envelope.text !== 'string' ||
        envelope.id !== parties.id ||
        envelope.from !== parties.senderId ||
        envelope.to !== parties.recipientId ||
        envelope.text.length > 12000
      )
        throw new Error('Invalid envelope');
    } catch {
      throw new BadRequestException('Invalid message content');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      iv,
    ).setAAD(
      Buffer.from(`${parties.id}:${parties.senderId}:${parties.recipientId}`),
    );
    const encrypted = Buffer.concat([
      cipher.update(body.ciphertext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        'base64',
      ),
      nonce: STORED_MESSAGE,
    };
  }

  open<T extends MessageBody>(body: T, parties: Parties): T {
    if (body.nonce !== STORED_MESSAGE)
      return { ...body, ciphertext: '', nonce: 'legacy-unavailable' };
    const bytes = Buffer.from(body.ciphertext, 'base64');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      bytes.subarray(0, 12),
    )
      .setAAD(
        Buffer.from(`${parties.id}:${parties.senderId}:${parties.recipientId}`),
      )
      .setAuthTag(bytes.subarray(12, 28));
    const ciphertext = Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString('utf8');
    return { ...body, ciphertext, nonce: MANAGED_MESSAGE };
  }

  view<
    T extends Parties &
      MessageBody & { replyTo?: (Parties & MessageBody) | null },
  >(message: T): T {
    const opened = this.open(message, message);
    return {
      ...opened,
      ...(message.replyTo && {
        replyTo: this.open(message.replyTo, message.replyTo),
      }),
    };
  }
}
