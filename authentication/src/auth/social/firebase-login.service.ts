import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { FirebaseService } from '../../firebase/firebase.service';
import { BCRYPT_ROUNDS, DEFAULT_USER_ROLE } from '../auth.constants';
import { ClientContext } from '../sessions/client-context';
import { SessionRevocationService } from '../sessions/session-revocation.service';
import { SignInService } from '../sessions/sign-in.service';
import { TokenPair } from '../sessions/token-issuer.service';
import {
  UserPatch,
  UserRecord,
  UserRepository,
} from '../users/user.repository';

interface FirebaseProfile {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  displayName: string | null;
  photoUrl: string | null;
}

/** Google serves every profile photo from this domain. */
const GOOGLE_PHOTO_HOST = '.googleusercontent.com';

function isGooglePhoto(url: string): boolean {
  return URL.canParse(url) && new URL(url).hostname.endsWith(GOOGLE_PHOTO_HOST);
}

/** Logs a user in (or creates the account) from a verified Firebase ID token. */
@Injectable()
export class FirebaseLoginService {
  private readonly logger = new Logger(FirebaseLoginService.name);

  constructor(
    @Inject(FirebaseService) private readonly firebase: FirebaseService,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SessionRevocationService)
    private readonly sessions: SessionRevocationService,
    @Inject(SignInService) private readonly signIn: SignInService,
  ) {}

  async login(idToken: string, client: ClientContext): Promise<TokenPair> {
    const profile = await this.readProfile(idToken);

    let user = await this.users.findByFirebaseUid(profile.uid);
    if (!user) user = await this.linkExistingAccount(profile);
    if (!user) user = await this.createAccount(profile);

    if (user.role === 'admin') {
      throw new UnauthorizedException('Use administrator sign-in');
    }

    user = await this.syncProfile(user, profile);
    return this.signIn.complete(user, client);
  }

  private async readProfile(idToken: string): Promise<FirebaseProfile> {
    const token = await this.firebase.verifyIdToken(idToken);
    // An SMS code proves a phone number for a password reset
    // (`PhonePasswordResetService`); it is not a way to sign in.
    if (
      token.firebase?.sign_in_provider !== 'google.com' ||
      token.email_verified !== true ||
      !token.email
    ) {
      throw new UnauthorizedException('Sign in with a verified Google account');
    }
    return {
      uid: token.uid,
      email: token.email ?? null,
      emailVerified: token.email_verified === true,
      phone: token.phone_number ?? null,
      displayName: (token.name as string | undefined) ?? null,
      photoUrl: token.picture ?? null,
    };
  }

  /**
   * Attaches the Firebase identity to an account that already exists with the
   * same email. An email is only trusted when Firebase verified it,
   * otherwise anyone could claim someone else's account.
   *
   * Registration never checked who owns that email or phone, so the account's
   * password may have been set by a stranger waiting for the real owner to sign
   * in. Linking therefore discards the password and ends every open session;
   * the owner can set a new password with "forgot password".
   */
  private async linkExistingAccount(
    profile: FirebaseProfile,
  ): Promise<UserRecord | null> {
    let existing: UserRecord | null = null;
    if (profile.email && profile.emailVerified) {
      existing = await this.users.findByEmail(profile.email);
    }
    if (!existing) return null;
    if (existing.role === 'admin') {
      throw new UnauthorizedException('Use administrator sign-in');
    }

    const patch = {
      firebase_uid: profile.uid,
      password_hash: await this.unusablePasswordHash(),
      has_password: false,
      email_verified: true,
      // A pre-registrant must not retain recovery through an unproven phone.
      ...(!existing.email_verified && { phone: null, phone_verified: false }),
    };
    await this.users.update(existing.id, patch);
    await this.sessions.endAllSessions(existing.id);
    return { ...existing, ...patch };
  }

  private async createAccount(profile: FirebaseProfile): Promise<UserRecord> {
    try {
      return await this.users.create({
        email: profile.email,
        phone: profile.phone,
        name: profile.displayName,
        avatar_url: profile.photoUrl,
        password_hash: await this.unusablePasswordHash(),
        role: DEFAULT_USER_ROLE,
        firebase_uid: profile.uid,
        email_verified: profile.emailVerified,
        phone_verified: false,
      });
    } catch {
      this.logger.error(
        `Could not create user for Firebase uid ${profile.uid}`,
      );
      throw new InternalServerErrorException(
        'Failed to create user from Firebase token',
      );
    }
  }

  /** Accounts without a password of their own still need a hash nobody can match. */
  private unusablePasswordHash(): Promise<string> {
    return bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  }

  /**
   * Copies the Google name onto an account that has none, and keeps a picture
   * that comes from Google ("Sync from Google account" in the app) the same as
   * the Google account's. A picture the user uploaded, or chose not to have,
   * is left alone: a new account gets the Google photo once, when it is created.
   */
  private async syncProfile(
    user: UserRecord,
    profile: FirebaseProfile,
  ): Promise<UserRecord> {
    const patch: UserPatch = {};
    if (
      !user.email_verified &&
      profile.emailVerified &&
      profile.email === user.email
    ) {
      Object.assign(patch, {
        email_verified: true,
        phone: null,
        phone_verified: false,
        password_hash: await this.unusablePasswordHash(),
        has_password: false,
      });
    }
    if (!user.name && profile.displayName) patch.name = profile.displayName;

    const followsGoogle = !!user.avatar_url && isGooglePhoto(user.avatar_url);
    if (
      followsGoogle &&
      profile.photoUrl &&
      profile.photoUrl !== user.avatar_url
    ) {
      patch.avatar_url = profile.photoUrl;
    }
    if (Object.keys(patch).length === 0) return user;

    await this.users.update(user.id, patch);
    if (patch.email_verified) await this.sessions.endAllSessions(user.id);
    return { ...user, ...patch };
  }
}
