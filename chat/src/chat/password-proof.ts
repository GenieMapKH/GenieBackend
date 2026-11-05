import { ForbiddenException } from '@nestjs/common';
import {
  KeySetUnavailableError,
  PASSWORD_PROOF_TOKEN,
  verifySignedToken,
} from '@tilomnov/shared';

/**
 * Passes when `token` shows that `userId` typed their account password within
 * the last few minutes. The authentication service checks the password and
 * signs the token (`POST /auth/account/password-proof`); this service never
 * sees the password. Answers `403` otherwise.
 */
export async function requirePasswordProof(
  userId: string,
  token: string,
): Promise<void> {
  try {
    const proof = await verifySignedToken(token, PASSWORD_PROOF_TOKEN);
    if (proof.sub === userId) return;
  } catch (error) {
    // Our outage is not a wrong password: let it surface as a server error.
    if (error instanceof KeySetUnavailableError) throw error;
    // Expired, forged or another kind of token: refused like someone else's.
  }
  throw new ForbiddenException('Confirm your password again');
}
