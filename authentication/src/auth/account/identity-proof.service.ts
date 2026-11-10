import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../../firebase/firebase.service';
import { UserRecord, UserRepository } from '../users/user.repository';

/** One of the two ways a signed-in user shows it is really them. */
export interface IdentityProof {
  /** The account password. */
  password?: string;
  /** A Firebase ID token from signing in with Google again, just now. */
  idToken?: string;
}

/** A Google sign-in older than this does not show who is holding the phone now. */
const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;

/**
 * An access token only shows that a device is signed in. Before something that
 * cannot be undone (new password, deactivating, deleting) the person has to
 * show they are the owner, so that a borrowed or stolen phone is not enough.
 */
@Injectable()
export class IdentityProofService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(FirebaseService) private readonly firebase: FirebaseService,
  ) {}

  /**
   * Returns the account when `proof` holds. Answers `403`, never `401`: the
   * app treats `401` as "session expired" and would sign the user out.
   */
  async verify(userId: string, proof: IdentityProof): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const proven = proof.password
      ? await bcrypt.compare(proof.password, user.password_hash)
      : !!proof.idToken &&
        (await this.isFreshGoogleSignIn(user, proof.idToken));
    if (!proven) {
      throw new ForbiddenException(
        proof.password
          ? 'The password is incorrect'
          : 'Could not confirm your Google account. Please try again.',
      );
    }
    return user;
  }

  private async isFreshGoogleSignIn(
    user: UserRecord,
    idToken: string,
  ): Promise<boolean> {
    if (!user.firebase_uid) return false;
    try {
      const token = await this.firebase.verifyIdToken(idToken);
      const ageSeconds = Date.now() / 1000 - token.auth_time;
      return (
        token.uid === user.firebase_uid && ageSeconds <= MAX_SIGN_IN_AGE_SECONDS
      );
    } catch {
      return false;
    }
  }
}
