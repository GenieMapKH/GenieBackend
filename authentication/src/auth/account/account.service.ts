import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../../firebase/firebase.service';
import { BCRYPT_ROUNDS } from '../auth.constants';
import { PasswordResetOtpRepository } from '../password-reset/password-reset-otp.repository';
import {
  EstablishedDeviceService,
  SessionCaller,
} from '../sessions/established-device.service';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import {
  UserPatch,
  UserRecord,
  UserRepository,
} from '../users/user.repository';
import { IdentityProof, IdentityProofService } from './identity-proof.service';
import { UserContentClient } from './user-content.client';

/**
 * What the owner can do to their own account while signed in: set its
 * password, switch it off, or delete it. Each asks for an [IdentityProof] first.
 *
 * Changing the password, deactivating and deleting also take the account away
 * from its other devices, so they are refused on a device that signed in less
 * than a day ago (`EstablishedDeviceService`): knowing the password is not
 * enough to lock the owner out.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionRevocationService)
    private readonly sessions: SessionRevocationService,
    @Inject(EstablishedDeviceService)
    private readonly devices: EstablishedDeviceService,
    @Inject(IdentityProofService) private readonly proofs: IdentityProofService,
    @Inject(UserContentClient) private readonly content: UserContentClient,
    @Inject(PasswordResetOtpRepository)
    private readonly otps: PasswordResetOtpRepository,
    @Inject(FirebaseService) private readonly firebase: FirebaseService,
  ) {}

  /** Every other device is signed out: whoever else knew the old password is gone. */
  async changePassword(
    caller: SessionCaller,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.devices.require(caller);
    await this.proofs.verify(caller.userId, { password: currentPassword });

    await this.users.update(
      caller.userId,
      await this.passwordPatch(newPassword),
    );
    await this.sessions.endAllSessions(caller.userId, caller.sessionId);
  }

  /**
   * Gives a password to an account that signs in with Google, which has none
   * of its own. Proven by signing in with Google again just now (`idToken`),
   * the same way such an account proves itself everywhere else.
   */
  async createPassword(
    caller: SessionCaller,
    idToken: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.proofs.verify(caller.userId, { idToken });
    if (user.has_password)
      throw new ConflictException(
        'Use change password or password reset for an existing password',
      );
    const patch = await this.passwordPatch(newPassword);
    await this.users.createInitialPassword(
      caller.userId,
      user.firebase_uid!,
      patch.password_hash!,
    );
    await this.sessions.endAllSessions(caller.userId, caller.sessionId);
  }

  /**
   * Hides the account and everything it posted, and signs every device out.
   * Nothing is removed: signing in again brings it all back (see `reactivate`).
   */
  async deactivate(caller: SessionCaller, proof: IdentityProof): Promise<void> {
    await this.devices.require(caller);
    const { id } = await this.proofs.verify(caller.userId, proof);

    await this.users.update(id, { deactivated_at: new Date().toISOString() });
    await this.sessions.endAllSessions(id);
    await this.content.visibilityChanged(id);
  }

  /**
   * Removes personal data: uploaded files, listings, chats, sessions, reset
   * codes and its Google sign-in record. Anonymized financial records remain.
   */
  async delete(caller: SessionCaller, proof: IdentityProof): Promise<void> {
    await this.devices.require(caller);
    const user = await this.proofs.verify(caller.userId, proof);

    await this.eraseAccount(user);
  }

  async adminDelete(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Account not found');
    if (user.role !== 'user')
      throw new ForbiddenException('Administrator accounts cannot be deleted');
    await this.eraseAccount(user);
  }

  async adminBan(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('Account not found');
    if (user.role !== 'user')
      throw new ForbiddenException('Administrator accounts cannot be banned');
    const now = new Date().toISOString();
    await this.users.update(userId, { banned_at: now, deactivated_at: now });
    await this.sessions.endAllSessions(userId);
    await this.content.visibilityChanged(userId);
  }

  private async eraseAccount(user: UserRecord): Promise<void> {
    // Hidden before anything is removed, so nobody is shown a listing whose photos are already gone.
    await this.users.update(user.id, {
      deactivated_at: new Date().toISOString(),
    });
    try {
      await this.content.eraseFiles(user.id);
    } catch (error) {
      // No row is deleted yet: show the account again so its owner can retry.
      await this.users.update(user.id, { deactivated_at: user.deactivated_at });
      throw error;
    }

    await this.sessions.endAllSessions(user.id);
    if (user.firebase_uid) await this.firebase.deleteUser(user.firebase_uid);
    if (user.email) await this.otps.deleteAllFor(user.email);
    // The database erases account content and unlinks retained financial records.
    await this.users.delete(user.id);
    await this.content.visibilityChanged(user.id);
  }

  /** Called on every successful sign-in: that is how a deactivated account comes back. */
  async reactivate(user: UserRecord): Promise<void> {
    if (user.banned_at)
      throw new ForbiddenException('This account has been banned');
    if (!user.deactivated_at) return;
    await this.users.update(user.id, { deactivated_at: null });
    await this.content.visibilityChanged(user.id);
  }

  private async passwordPatch(password: string): Promise<UserPatch> {
    return {
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      has_password: true,
    };
  }
}
