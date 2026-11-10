import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  initializeApp,
  cert,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

@Injectable()
export class FirebaseService {
  private firebaseApp: App;

  constructor() {
    // Read the service account config from environment variables
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccount) {
      new Logger(FirebaseService.name).warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not set in the environment.',
      );
      // Fallback for initializing without explicit credentials
      this.firebaseApp = initializeApp();
    } else {
      try {
        const credentials = JSON.parse(serviceAccount) as ServiceAccount;
        this.firebaseApp = initializeApp({
          credential: cert(credentials),
        });
      } catch {
        throw new InternalServerErrorException(
          'Failed to parse Firebase credentials',
        );
      }
    }
  }

  /**
   * Removes the sign-in record Firebase keeps for a Google account (email,
   * name, photo). Never throws: the record is outside our database, and a
   * leftover one only means Firebase still knows that Google account.
   */
  async deleteUser(uid: string): Promise<void> {
    try {
      await getAuth(this.firebaseApp).deleteUser(uid);
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/user-not-found') return;
      new Logger(FirebaseService.name).error(
        `Could not delete Firebase user ${uid}: ${(error as Error).message}`,
      );
    }
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    try {
      return await getAuth(this.firebaseApp).verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }
}
