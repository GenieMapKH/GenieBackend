import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { RateLimit, RateLimits } from '@tilomnov/shared';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { Observable, from, mergeMap } from 'rxjs';

/** How a listing or a person is reached: only signed-in users see them. */
const CONTACT_KEYS = new Set([
  'email',
  'phone',
  'contactPhone',
  'additionalContactPhones',
]);

/**
 * Answers with contact details one account may receive. Far more than anyone
 * looking for a home opens; a script collecting numbers needs many more.
 */
const CONTACT_REVEALS_PER_HOUR = 100;
const CONTACT_REVEALS_PER_DAY = 300;

/**
 * `body` without any contact details, at any depth: the owner on a listing,
 * a listing's own phone, a publisher's profile. A copy, so a cached answer
 * shared with signed-in callers keeps them. Only plain objects and arrays are
 * walked; dates and prices (Prisma decimals) are kept as they are.
 */
export function withoutContactDetails<T>(body: T): T {
  if (Array.isArray(body)) {
    return body.map((item: unknown) => withoutContactDetails(item)) as T;
  }
  if (!isPlainObject(body)) return body;

  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (CONTACT_KEYS.has(key)) continue;
    copy[key] = withoutContactDetails(value);
  }
  return copy as T;
}

/** Whether `body` carries a phone or an email anywhere. */
export function hasContactDetails(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(hasContactDetails);
  if (!isPlainObject(body)) return false;
  return Object.entries(body).some(([key, value]) =>
    CONTACT_KEYS.has(key)
      ? Array.isArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && value !== ''
      : hasContactDetails(value),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** The caller's own listing (`userId`) or own profile (`id`): nothing to protect. */
function isOwnedBy(body: unknown, viewerId: string): boolean {
  if (!isPlainObject(body)) return false;
  return body.userId === viewerId || body.id === viewerId;
}

/**
 * Who sees phone numbers and emails on the public routes.
 *
 * - Guests never do, so the routes cannot be used to collect them.
 * - A signed-in user does, on up to a few hundred answers a day. Past that
 *   the answer comes without them: browsing goes on, collecting stops.
 *
 * Only answers that carry contact details are counted (one listing, one
 * publisher's page); map and search lists never carry them. Put after
 * `OptionalJwtAuthGuard`, which tells who is signed in.
 */
@Injectable()
export class ContactDetailsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ContactDetailsInterceptor.name);
  private readonly perHour: RateLimit;
  private readonly perDay: RateLimit;

  constructor(rateLimits: RateLimits) {
    this.perHour = rateLimits.create(
      'contact-reveal-hour',
      CONTACT_REVEALS_PER_HOUR,
      60 * 60,
    );
    this.perDay = rateLimits.create(
      'contact-reveal-day',
      CONTACT_REVEALS_PER_DAY,
      24 * 60 * 60,
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const viewerId = context
      .switchToHttp()
      .getRequest<{ user?: { userId: string } | null }>().user?.userId;
    return next
      .handle()
      .pipe(mergeMap((body: unknown) => from(this.forViewer(body, viewerId))));
  }

  private async forViewer(
    body: unknown,
    viewerId: string | undefined,
  ): Promise<unknown> {
    if (!hasContactDetails(body)) return body;
    if (!viewerId) return withoutContactDetails(body);
    if (isOwnedBy(body, viewerId)) return body;
    return (await this.mayReveal(viewerId))
      ? body
      : withoutContactDetails(body);
  }

  private async mayReveal(viewerId: string): Promise<boolean> {
    try {
      await this.perHour.consume(viewerId);
      await this.perDay.consume(viewerId);
      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        this.logger.warn(
          `Contact details withheld from ${viewerId}: over the limit`,
        );
        return false;
      }
      // The limiter itself failed: an outage of ours must not hide every number.
      this.logger.error(
        `Contact limit could not be checked: ${(error as Error).message}`,
      );
      return true;
    }
  }
}
