import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  EstablishedDeviceService,
  SessionCaller,
} from '../sessions/established-device.service';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';
import { normalizePhoneNumber } from '@tilomnov/shared';
import { IdentityProof, IdentityProofService } from './identity-proof.service';

@Injectable()
export class AccountPhoneService {
  constructor(
    private readonly users: UserRepository,
    private readonly devices: EstablishedDeviceService,
    private readonly identities: IdentityProofService,
    private readonly sessions: SessionRevocationService,
  ) {}

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
