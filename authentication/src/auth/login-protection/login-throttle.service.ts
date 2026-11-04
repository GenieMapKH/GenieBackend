import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AttemptLimiter, AuthAttemptLimits } from '../attempt-limiter';
import { KnownLoginDevices } from './known-login-devices.store';

/** Who is trying to sign in, and to which account. */
export interface LoginSource {
  /** The email or phone typed, normalized: one key per account. */
  account: string;
  /** Written by the api-gateway; null only when the service is called directly. */
  ipAddress: string | null;
  /** The device's own secret (`X-Device-Key`), when the app sent a valid one. */
  deviceKey: string | null;
}

/** In the `429` body when the account itself is paused for unknown devices. */
export const ACCOUNT_UNDER_ATTACK = 'ACCOUNT_UNDER_ATTACK';

interface Reserved {
  limiter: AttemptLimiter;
  key: string;
}

/**
 * Stops password guessing without letting a guesser lock the owner out.
 *
 * Wrong passwords are counted per source: the network (or, for a device that
 * signed in to the account before, that device). Someone typing a friend's
 * number over and over only pauses themselves; the owner, on another network
 * or on their own phone, still signs in.
 *
 * Two wider limits catch what a single source cannot: one network trying many
 * accounts, and one account tried from many networks. The second pauses only
 * devices the account never signed in on, so its owner keeps getting in.
 *
 * Only wrong passwords count. An attempt is counted before the password is
 * checked (so simultaneous guesses cannot slip past) and given back when it
 * succeeds or fails for another reason.
 */
@Injectable()
export class LoginThrottle {
  private readonly logger = new Logger(LoginThrottle.name);

  constructor(
    @Inject(AuthAttemptLimits) private readonly limits: AuthAttemptLimits,
    @Inject(KnownLoginDevices) private readonly knownDevices: KnownLoginDevices,
  ) {}

  async guard<T>(source: LoginSource, signIn: () => Promise<T>): Promise<T> {
    const known = await this.knownDevices.isKnown(
      source.account,
      source.deviceKey,
    );
    const sourceKey = this.sourceKeyOf(source, known);
    const reserved = await this.reserve(source, sourceKey, known);

    let result: T;
    try {
      result = await signIn();
    } catch (error) {
      // A wrong password stays counted; anything else was not a guess.
      if (!(error instanceof UnauthorizedException)) {
        await this.release(reserved);
      }
      throw error;
    }

    await this.release(reserved);
    await this.afterSuccess(source, sourceKey);
    return result;
  }

  private sourceKeyOf(source: LoginSource, known: boolean): string {
    return known
      ? `${source.account}|device:${source.deviceKey}`
      : `${source.account}|ip:${source.ipAddress ?? 'unknown'}`;
  }

  /** Counts the attempt everywhere it applies, or refuses it without counting it anywhere. */
  private async reserve(
    source: LoginSource,
    sourceKey: string,
    known: boolean,
  ): Promise<Reserved[]> {
    const steps: (Reserved & { refusal: () => HttpException })[] = [
      {
        limiter: this.limits.loginPerSource,
        key: sourceKey,
        refusal: () => tooMany('Too many attempts. Try again in 15 minutes.'),
      },
    ];
    // A device the account knows is the owner's: the wider limits are for strangers.
    if (!known) {
      steps.push(
        {
          limiter: this.limits.loginPerNetwork,
          key: source.ipAddress ?? 'unknown',
          refusal: () =>
            tooMany(
              'Too many sign-in attempts from this network. Try again in an hour.',
            ),
        },
        {
          limiter: this.limits.loginPerAccount,
          key: source.account,
          refusal: () =>
            tooMany(
              'Too many sign-in attempts on this account. Try again later, or sign in on a device you used before.',
              ACCOUNT_UNDER_ATTACK,
            ),
        },
      );
    }

    const reserved: Reserved[] = [];
    for (const step of steps) {
      if (!(await step.limiter.tryConsume(step.key))) {
        await this.release(reserved);
        throw step.refusal();
      }
      reserved.push(step);
    }
    return reserved;
  }

  private async release(reserved: Reserved[]): Promise<void> {
    for (const { limiter, key } of reserved) {
      try {
        await limiter.refund(key);
      } catch (error) {
        this.logger.warn(
          `Sign-in attempt not given back: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Earlier typos from this source are forgotten, and the device is known from now on. */
  private async afterSuccess(
    source: LoginSource,
    sourceKey: string,
  ): Promise<void> {
    try {
      await this.limits.loginPerSource.reset(sourceKey);
    } catch (error) {
      this.logger.warn(
        `Sign-in attempts not cleared: ${(error as Error).message}`,
      );
    }
    await this.knownDevices.remember(source.account, source.deviceKey);
  }
}

function tooMany(message: string, code?: string): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message,
      ...(code && { code }),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
