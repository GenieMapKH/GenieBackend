import { ConflictException, Injectable } from '@nestjs/common';
import {
  EstablishedDeviceService,
  SessionCaller,
} from '../sessions/established-device.service';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { UserRepository } from '../users/user.repository';
import { PhoneProofService } from '../verification/phone-proof.service';
import { IdentityProof, IdentityProofService } from './identity-proof.service';

@Injectable()
export class AccountPhoneService {
  constructor(
    private readonly users: UserRepository,
    private readonly devices: EstablishedDeviceService,
    private readonly identities: IdentityProofService,
    private readonly phones: PhoneProofService,
    private readonly sessions: SessionRevocationService,
  ) {}

  async change(
    caller: SessionCaller,
    phoneToken: string,
    proof: IdentityProof,
  ): Promise<void> {
    const user = await this.identities.verify(caller.userId, proof);
    const phone = await this.phones.verify(phoneToken);
    const changing = phone !== user.phone;
    if (changing) await this.devices.require(caller);
    const owner = await this.users.findByPhone(phone);
    if (owner && owner.id !== user.id)
      throw new ConflictException('Phone number is already taken');
    await this.users.update(user.id, { phone, phone_verified: true });
    if (changing) await this.sessions.endAllSessions(user.id, caller.sessionId);
  }
}
