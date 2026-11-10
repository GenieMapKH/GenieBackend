import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

const TIMEOUT_MS = 5_000;

/**
 * Who a user follows, asked of the user service, which owns following and
 * caches the answer. This service never reads the follows table itself.
 */
export class FollowedAccounts {
  private readonly logger = new Logger(FollowedAccounts.name);
  private readonly client: ServiceClient;

  constructor(baseUrl: string) {
    this.client = new ServiceClient('user', baseUrl, 'property');
  }

  /** The ids `userId` follows. A 503 when the user service cannot answer. */
  async idsFollowedBy(userId: string): Promise<string[]> {
    try {
      return await this.client.call<string[]>(
        'GET',
        `/internal/follows/${userId}/following`,
        { timeoutMs: TIMEOUT_MS },
      );
    } catch (error) {
      this.logger.error(
        `Could not read who ${userId} follows: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('The feed is not available');
    }
  }
}
