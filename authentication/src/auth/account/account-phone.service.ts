import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstablishedDeviceService,
  SessionCaller,
} from '../sessions/established-device.service';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';
import { normalizePhoneNumber } from '@tilomnov/shared';
import { IdentityProof, IdentityProofService } from './identity-proof.service';
import { PhoneVerificationService } from '../verification/phone-verification.service';

@Injectable()
export class AccountPhoneService {
  constructor(
    private readonly users: UserRepository,
    private readonly devices: EstablishedDeviceService,
    private readonly identities: IdentityProofService,
    private readonly sessions: SessionRevocationService,
    private readonly phones: PhoneVerificationService,
  ) {}

  /** Verifies the first/current phone without bypassing protected phone changes. */
  async verify(
    caller: SessionCaller,
    phone: string,
    phoneProof: string,
  ): Promise<void> {
    const user = await this.users.findById(caller.userId);
    if (!user) throw new NotFoundException('Account not found');
    if (user.phone && normalizePhoneNumber(user.phone) !== phone) {
      throw new ForbiddenException({
        code: 'PHONE_CHANGE_REQUIRED',
        message:
          'Change your account phone in settings before verifying a different number.',
      });
    }
    await this.phones.requireProof(phone, phoneProof);
    const owner = await this.users.findByPhone(phone);
    if (owner && owner.id !== user.id)
      throw new ConflictException('Phone number is already taken');
    await this.users.verifyPhone(user.id, user.phone, phone);
  }

  async change(
    caller: SessionCaller,
    number: string,
    proof: IdentityProof,
  ): Promise<void> {
    const user = await this.identities.verify(caller.userId, proof);
    const phone = normalizePhoneNumber(number);
    if (!phone) throw new BadRequestException('Enter a valid phone number');
    const changing = phone !== user.phone;
    if (changing) await this.devices.require(caller);
    const owner = await this.users.findByPhone(phone);
    if (owner && owner.id !== user.id)
      throw new ConflictException('Phone number is already taken');
    await this.users.update(user.id, { phone, phone_verified: false });
    if (changing) await this.sessions.endAllSessions(user.id, caller.sessionId);
  }
}
