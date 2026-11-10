import { Injectable } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

const TIMEOUT_MS = 5_000;

/**
 * Who follows an account, asked of the user service, which owns following.
 * This service never reads the follows table itself.
 */
@Injectable()
export class AccountFollowers {
  private readonly client = new ServiceClient(
    'user',
    process.env.USER_SERVICE_URL || 'http://localhost:4002',
    'property',
  );

  /** Throws when the user service cannot answer. */
  idsFollowing(userId: string): Promise<string[]> {
    return this.client.call<string[]>(
      'GET',
      `/internal/follows/${userId}/followers`,
      { timeoutMs: TIMEOUT_MS },
    );
  }
}
