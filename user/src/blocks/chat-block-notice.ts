import { Injectable, Logger } from '@nestjs/common';
import { MessageBus, ServiceClient } from '@tilomnov/shared';
import { Prisma } from '@tilomnov/prisma-client';

/** A block is answered without waiting long for the chat service. */
const TIMEOUT_MS = 3_000;

/**
 * Tells the chat service that someone blocked someone, so the two stop seeing
 * each other online at once. Messages and calls already ask about blocks
 * every time; this is only for presence watched before the block.
 */
@Injectable()
export class ChatBlockNotice {
  private readonly logger = new Logger(ChatBlockNotice.name);
  private readonly client = new ServiceClient(
    'chat',
    process.env.CHAT_SERVICE_URL || 'http://localhost:4004',
    'user',
  );

  constructor(private readonly messages: MessageBus) {}
  get queued(): boolean {
    return this.messages.enabled;
  }

  /**
   * Never throws: the block is saved either way, and a chat service that is
   * down only means presence watched before it keeps flowing until the
   * conversation is closed.
   */
  async blocked(
    blockerId: string,
    blockedId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (this.queued) {
      await this.messages.enqueue(
        'chat.user-blocked.v1',
        { blockerId, blockedId },
        { tx },
      );
      return;
    }
    try {
      await this.client.call(
        'POST',
        `/internal/blocks/${blockerId}/${blockedId}`,
        { timeoutMs: TIMEOUT_MS },
      );
    } catch (error) {
      this.logger.warn(
        `The chat service was not told of a block: ${(error as Error).message}`,
      );
    }
  }
}
