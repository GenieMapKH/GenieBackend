import { Logger } from '@nestjs/common';
import { ServiceClient } from '@tilomnov/shared';

const ERASE_TIMEOUT_MS = 30_000;
const NOTICE_TIMEOUT_MS = 5_000;

/** Injection tokens: one remote per service that keeps content for an account. */
export const PROPERTY_CONTENT = Symbol('PROPERTY_CONTENT');
export const CHAT_CONTENT = Symbol('CHAT_CONTENT');

/**
 * What another service keeps for an account (listing photos, chat files,
 * caches), reached through that service's `/internal/accounts/:userId` routes.
 * This service only knows that those routes exist, not what is behind them.
 */
export class RemoteAccountContent {
  private readonly logger = new Logger(RemoteAccountContent.name);
  private readonly client: ServiceClient;

  constructor(
    private readonly name: string,
    baseUrl: string,
  ) {
    this.client = new ServiceClient(name, baseUrl, 'user');
  }

  /** Deletes every file the service holds for the account. Throws when it is not confirmed. */
  eraseFiles(userId: string): Promise<void> {
    return this.client.call('DELETE', `/internal/accounts/${userId}/files`, {
      timeoutMs: ERASE_TIMEOUT_MS,
    });
  }

  /**
   * The account was hidden, shown again or deleted: the service drops what it
   * caches about it. Never throws; those caches expire on their own within
   * two minutes, and a service that is down must not block a profile change.
   */
  async notifyVisibilityChanged(userId: string): Promise<void> {
    try {
      await this.client.call(
        'POST',
        `/internal/accounts/${userId}/visibility-changed`,
        { timeoutMs: NOTICE_TIMEOUT_MS },
      );
    } catch (error) {
      this.logger.warn(
        `The ${this.name} service did not clear its caches for ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
