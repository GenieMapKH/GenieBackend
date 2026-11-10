import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PhoneProofService } from '../verification/phone-proof.service';
import { AuthAttemptLimits } from '../attempt-limiter';
import { BCRYPT_ROUNDS } from '../auth.constants';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';

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
    private readonly phones: PhoneProofService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionRevocationService)
    private readonly sessions: SessionRevocationService,
    @Inject(AuthAttemptLimits) private readonly limits: AuthAttemptLimits,
  ) {}

  async reset(
    idToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const phone = await this.phones.verify(idToken);
    await this.limits.phoneResets.consumeOrReject(phone, 'tomorrow');

    const user = await this.users.findByPhone(phone);
    if (!user?.phone_verified) {
      // The caller just proved they hold this number, so saying so tells them nothing new.
      throw new NotFoundException(
        'This phone number is not verified for password recovery. Sign in and verify it in Account Security.',
      );
    }

    await this.users.update(user.id, {
      password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      has_password: true,
    });
    // Whoever knew the old password is signed out everywhere.
    await this.sessions.endAllSessions(user.id);
    return { message: 'Password reset successfully' };
  }
}
