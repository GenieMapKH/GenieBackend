import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  INTERNAL_TOKEN_TTL_SECONDS,
  INTERNAL_TOKEN_TYPE,
} from '../auth.constants';
import { TokenSigner } from '../signing-keys/token-signer.service';

const ERASE_TIMEOUT_MS = 30_000;
const NOTICE_TIMEOUT_MS = 5_000;

/**
 * Asks the user service to act on what it keeps for an account: uploaded
 * files (listing photos, chat attachments, profile picture) and its caches.
 * Only that service knows where those are.
 *
 * The call goes straight to the user service, not through the gateway, which
 * does not forward `/internal`. Each call carries a one-minute token signed
 * with the JWT key and naming the account, so nobody else can make it.
 */
@Injectable()
export class UserContentClient {
  private readonly logger = new Logger(UserContentClient.name);
  private readonly baseUrl = (
    process.env.USER_SERVICE_URL || 'http://localhost:4002'
  ).replace(/\/+$/, '');

  constructor(@Inject(TokenSigner) private readonly signer: TokenSigner) {}

  /**
   * Removes every file the account uploaded, for good. Throws `503` when the
   * user service did not confirm it, so an account is never deleted while its
   * files stay behind.
   */
  async eraseFiles(userId: string): Promise<void> {
    try {
      await this.call('DELETE', userId, 'files', ERASE_TIMEOUT_MS);
    } catch (error) {
      this.logger.error(
        `Files of ${userId} were not erased: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'The account could not be deleted right now. Please try again.',
      );
    }
  }

  /**
   * The account was hidden, shown again or deleted: drop what is cached about
   * it. Never throws; those caches expire on their own within two minutes.
   */
  async visibilityChanged(userId: string): Promise<void> {
    try {
      await this.call('POST', userId, 'visibility-changed', NOTICE_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn(
        `Caches of ${userId} were not cleared: ${(error as Error).message}`,
      );
    }
  }

  private async call(
    method: string,
    userId: string,
    action: string,
    timeoutMs: number,
  ): Promise<void> {
    const token = this.signer.sign(
      { sub: userId, typ: INTERNAL_TOKEN_TYPE },
      INTERNAL_TOKEN_TTL_SECONDS,
    );
    const response = await fetch(
      `${this.baseUrl}/internal/accounts/${userId}/${action}`,
      {
        method,
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`the user service answered ${response.status}`);
    }
  }
}
