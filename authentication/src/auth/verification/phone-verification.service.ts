import { BadRequestException, Injectable } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

/** Accepts only a recent Firebase SMS sign-in for the exact requested number. */
@Injectable()
export class PhoneVerificationService {
  constructor(private readonly firebase: FirebaseService) {}

  async requireProof(phone: string, proof?: string): Promise<void> {
    try {
      if (!proof) throw new Error('Missing proof');
      const token = await this.firebase.verifyIdToken(proof, true);
      const age = Date.now() / 1000 - token.auth_time;
      if (
        token.firebase?.sign_in_provider !== 'phone' ||
        token.phone_number !== phone ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > 300
      )
        throw new Error('Invalid phone proof');
    } catch {
      throw new BadRequestException(
        'Verify this phone number with a new SMS code before continuing.',
      );
    }
  }
}
