import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

/** A message waits on this answer: never long. */
const TIMEOUT_MS = 2_000;

/** Said to a sender either has blocked; `code` lets the app show it instead of the composer. */
export class BlockedException extends ForbiddenException {
  readonly code = 'blocked';

  constructor() {
    super('You cannot message this person.');
  }
}

/**
 * Whether two people may reach each other, asked of the user service, which
 * owns blocking and caches the answer. This service never reads the blocks
 * table itself.
 */
@Injectable()
export class BlockChecker {
  private readonly logger = new Logger(BlockChecker.name);
  private readonly client = new ServiceClient(
    'user',
    process.env.USER_SERVICE_URL || 'http://localhost:4002',
    'chat',
  );

  /**
   * True when either has blocked the other. When the user service cannot
   * answer, false: chat keeps working through its outage, and the failure is
   * logged.
   */
  async eitherBlocked(userId: string, otherId: string): Promise<boolean> {
    try {
      const answer = await this.client.call<{ blocked: boolean }>(
        'GET',
        `/internal/blocks/${userId}/with/${otherId}`,
        { timeoutMs: TIMEOUT_MS },
      );
      return answer.blocked === true;
    } catch (error) {
      this.logger.warn(
        `Could not check blocks between ${userId} and ${otherId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Refuses with [BlockedException] when either has blocked the other. */
  async requireNotBlocked(userId: string, otherId: string): Promise<void> {
    if (await this.eitherBlocked(userId, otherId)) {
      throw new BlockedException();
    }
  }
}
