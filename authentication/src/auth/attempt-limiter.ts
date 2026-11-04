import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { RedisConnection } from '../redis/redis-connection';

interface Limiter {
  consume(key: string): Promise<unknown>;
  reward(key: string, points: number): Promise<unknown>;
  delete(key: string): Promise<boolean>;
}

/**
 * Allows a fixed number of attempts per key (an email, a phone number) in a
 * time window, so a password or a 6-digit code cannot be guessed by trying
 * them all.
 */
export class AttemptLimiter {
  constructor(private readonly limiter: Limiter) {}

  /** Records one attempt. Returns false once the key has none left in this window. */
  async tryConsume(key: string): Promise<boolean> {
    try {
      await this.limiter.consume(key);
      return true;
    } catch (rejected) {
      if (rejected instanceof RateLimiterRes) return false;
      throw rejected;
    }
  }

  /** Records one attempt, or answers `429` once the key has none left. */
  async consumeOrReject(key: string, retry = 'in 15 minutes'): Promise<void> {
    if (!(await this.tryConsume(key))) {
      throw new HttpException(
        `Too many attempts. Try again ${retry}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Forgets a key, e.g. after a successful login. */
  async reset(key: string): Promise<void> {
    await this.limiter.delete(key);
  }

  /** Gives back one attempt that turned out not to be a guess. */
  async refund(key: string): Promise<void> {
    await this.limiter.reward(key, 1);
  }
}

const ONE_MINUTE = 60;
const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * 60 * 60;

/**
 * Every attempt limit of the auth endpoints. Counts live in Redis, so they are
 * shared by all instances and a restart does not hand an attacker fresh tries.
 * Without Redis (unreachable, or in tests) each instance counts in memory.
 */
@Injectable()
export class AuthAttemptLimits {
  /**
   * Wrong passwords for one account from one network, or from one device that
   * signed in to it before. Stops guessing without locking the owner out:
   * only the source that guesses is paused (see `LoginThrottle`).
   */
  readonly loginPerSource: AttemptLimiter;

  /** Wrong passwords from one network, whatever the account: stops trying leaked passwords on many accounts. */
  readonly loginPerNetwork: AttemptLimiter;

  /**
   * Wrong passwords for one account from devices it never signed in on, from
   * every network together. Stops guessing spread over many networks; the
   * owner's own devices are not counted, so they still get in.
   */
  readonly loginPerAccount: AttemptLimiter;

  /** New accounts from one network: throwaway accounts cost something to make. */
  readonly registrationsPerNetwork: AttemptLimiter;

  /** One reset email per address a minute: a tapped-twice "Resend" sends one. */
  readonly resetCooldown: AttemptLimiter;

  /** Reset emails per address: stops inbox flooding and endless fresh codes. */
  readonly resetRequests: AttemptLimiter;

  /** Reset emails per address in a day, so the 15-minute window cannot be repeated all day. */
  readonly resetRequestsPerDay: AttemptLimiter;

  /**
   * Reset requests per caller address, known accounts or not: one caller cannot
   * flood many inboxes or probe a list of addresses.
   */
  readonly resetRequestsPerClient: AttemptLimiter;

  /** Guesses at a 6-digit reset code per address, across verify and reset. */
  readonly otp: AttemptLimiter;

  /**
   * A 6-digit code has only a million values, so guesses are capped per day as
   * well: at 5 per 15 minutes alone, a year of patient guessing would succeed
   * about one time in six.
   */
  readonly otpPerDay: AttemptLimiter;

  /** Password resets per phone number in a day, each proven by an SMS code. */
  readonly phoneResets: AttemptLimiter;

  /** Wrong passwords per signed-in account when confirming a sensitive change. */
  readonly identityProof: AttemptLimiter;

  constructor(@Optional() private readonly redis?: RedisConnection) {
    this.loginPerSource = this.limit('login-source', 10, FIFTEEN_MINUTES);
    this.loginPerNetwork = this.limit('login-network', 100, ONE_HOUR);
    this.loginPerAccount = this.limit('login-account', 50, ONE_HOUR);
    this.registrationsPerNetwork = this.limit('register-network', 20, ONE_HOUR);
    this.resetCooldown = this.limit('reset-cooldown', 1, ONE_MINUTE);
    this.resetRequests = this.limit('reset-request', 3, FIFTEEN_MINUTES);
    this.resetRequestsPerDay = this.limit('reset-request-day', 6, ONE_DAY);
    this.resetRequestsPerClient = this.limit(
      'reset-request-client',
      10,
      ONE_HOUR,
    );
    this.otp = this.limit('otp', 5, FIFTEEN_MINUTES);
    this.otpPerDay = this.limit('otp-day', 15, ONE_DAY);
    this.identityProof = this.limit('identity-proof', 10, FIFTEEN_MINUTES);
    this.phoneResets = this.limit('phone-reset-day', 5, ONE_DAY);
  }

  private limit(
    name: string,
    points: number,
    duration: number,
  ): AttemptLimiter {
    const inMemory = new RateLimiterMemory({ points, duration });
    if (!this.redis) return new AttemptLimiter(inMemory);

    return new AttemptLimiter(
      new RateLimiterRedis({
        storeClient: this.redis.client,
        keyPrefix: `limit:auth:${name}`,
        points,
        duration,
        insuranceLimiter: inMemory,
      }),
    );
  }
}
