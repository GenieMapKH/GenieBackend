import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../../firebase/firebase.service';
import { AuthAttemptLimits } from '../attempt-limiter';
import { BCRYPT_ROUNDS } from '../auth.constants';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';

/** An SMS code typed longer ago than this no longer shows who holds the phone. */
const MAX_PROOF_AGE_SECONDS = 5 * 60;

const NOT_PROVEN = 'Could not confirm this phone number. Please try again.';

/**
 * "Forgot password" for an account's phone number. The app has Firebase text
 * a code to the number; once the code is typed, Firebase gives it an ID token
 * that names the number. That token is the proof here, the way a code sent
 * by email is for an email address.
 *
 * The token only resets a password: it never signs anyone in (see
 * `FirebaseLoginService`), so every device is signed out and the owner signs
 * in again with the new password.
 */
@Injectable()
export class PhonePasswordResetService {
  constructor(
    @Inject(FirebaseService) private readonly firebase: FirebaseService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionRevocationService)
    private readonly sessions: SessionRevocationService,
    @Inject(AuthAttemptLimits) private readonly limits: AuthAttemptLimits,
  ) {}

  async reset(
    idToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const phone = await this.provenPhone(idToken);
    await this.limits.phoneResets.consumeOrReject(phone, 'tomorrow');

    const user = await this.users.findByPhone(phone);
    if (!user) {
      // The caller just proved they hold this number, so saying so tells them nothing new.
      throw new NotFoundException('No account uses this phone number');
    }

    await this.users.update(user.id, {
      password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      has_password: true,
    });
    // Whoever knew the old password is signed out everywhere.
    await this.sessions.endAllSessions(user.id);
    return { message: 'Password reset successfully' };
  }

  /**
   * The phone number a fresh SMS confirmation proves. `400`, never `401`: the
   * app reads `401` as "your session expired".
   */
  private async provenPhone(idToken: string): Promise<string> {
    let token: Awaited<ReturnType<FirebaseService['verifyIdToken']>>;
    try {
      token = await this.firebase.verifyIdToken(idToken);
    } catch {
      throw new BadRequestException(NOT_PROVEN);
    }

    // A Google sign-in may carry a phone number too, but it was never texted.
    const byPhone = token.firebase?.sign_in_provider === 'phone';
    const ageSeconds = Date.now() / 1000 - token.auth_time;
    if (!byPhone || !token.phone_number) {
      throw new BadRequestException(NOT_PROVEN);
    }
    if (ageSeconds > MAX_PROOF_AGE_SECONDS) {
      throw new BadRequestException(
        'The code was confirmed too long ago. Please ask for a new one.',
      );
    }
    return token.phone_number;
  }
}
