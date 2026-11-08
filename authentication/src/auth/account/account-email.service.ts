import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  EstablishedDeviceService,
  SessionCaller,
} from '../sessions/established-device.service';
import { UserRepository } from '../users/user.repository';
import { IdentityProofService } from './identity-proof.service';
import { EmailVerificationService } from '../verification/email-verification.service';

/**
 * Adds an email to an account made with only a phone number. Once added,
 * "forgot password" sends its codes there.
 *
 * That makes the email a way back into the account, so it takes the same
 * protection as changing the password: the password, typed again, on a device
 * that has been signed in for a day. Otherwise someone who just got in with a
 * stolen password could add their own address and reset the password later,
 * even after the owner changed it.
 */
@Injectable()
export class AccountEmailService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(EstablishedDeviceService)
    private readonly devices: EstablishedDeviceService,
    @Inject(IdentityProofService) private readonly proofs: IdentityProofService,
    private readonly emails: EmailVerificationService,
  ) {}

  /** `email` is already normalized (`AddEmailDto`). */
  async addEmail(
    caller: SessionCaller,
    email: string,
    password: string,
    emailProof: string,
  ): Promise<void> {
    await this.devices.require(caller);
    const user = await this.proofs.verify(caller.userId, { password });

    this.emails.requireProof(email, emailProof);
    if (user.email && user.email !== email) {
      throw new ConflictException('This account already has an email');
    }
    const owner = await this.users.findByEmail(email);
    if (owner && owner.id !== user.id) {
      throw new ConflictException('Email or phone already exists');
    }
    await this.users.update(user.id, { email, email_verified: true });
  }
}
