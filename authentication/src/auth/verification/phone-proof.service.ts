import { BadRequestException, Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

/** A fresh SMS sign-in proves the number, independently of any client-supplied phone. */
@Injectable()
export class PhoneProofService {
  constructor(private readonly firebase: FirebaseService) {}

  async verify(idToken: string): Promise<string> {
    try {
      const token = await this.firebase.verifyIdToken(idToken);
      const age = Date.now() / 1000 - token.auth_time;
      if (
        token.firebase?.sign_in_provider !== 'phone' ||
        !token.phone_number ||
        !Number.isFinite(age) ||
        age < -60 ||
        age > 300
      )
        throw new Error('Invalid SMS proof');
      return token.phone_number;
    } catch {
      throw new BadRequestException(
        'Confirm your phone number with a new SMS code.',
      );
    }
  }
}
