import { Inject, Injectable } from '@nestjs/common';
import {
  PASSWORD_PROOF_TOKEN_TYPE,
  PASSWORD_PROOF_TTL_SECONDS,
} from '../auth.constants';
import { TokenSigner } from '../signing-keys/token-signer.service';
import { IdentityProofService } from './identity-proof.service';

export interface PasswordProof {
  proofToken: string;
  expiresInSeconds: number;
}

/**
 * Gives a signed-in user who just typed their password a short-lived token
 * that says so.
 *
 * Only this service can check a password, but the user service is where a
 * forgotten chat PIN is recovered. The app carries this token from one to the
 * other: the user service checks the signature and never sees the password.
 */
@Injectable()
export class PasswordProofService {
  constructor(
    @Inject(TokenSigner) private readonly signer: TokenSigner,
    @Inject(IdentityProofService) private readonly proofs: IdentityProofService,
  ) {}

  /** `403` for a wrong password, or for an account that has none yet. */
  async issue(userId: string, password: string): Promise<PasswordProof> {
    await this.proofs.verify(userId, { password });

    const proofToken = this.signer.sign(
      { sub: userId, typ: PASSWORD_PROOF_TOKEN_TYPE },
      PASSWORD_PROOF_TTL_SECONDS,
    );
    return { proofToken, expiresInSeconds: PASSWORD_PROOF_TTL_SECONDS };
  }
}
