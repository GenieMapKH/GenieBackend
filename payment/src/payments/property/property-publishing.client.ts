import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ServiceCallError, ServiceClient } from '@tilomnov/shared';

const TIMEOUT_MS = 8_000;

/** Where a listing can end up after a payment. */
export type PublishOutcome = 'Active' | 'Draft';

/**
 * The listing's side of a payment, owned by the property service: it alone
 * decides who may publish and changes a listing's status. This service asks.
 *
 * A refusal from the property service (not the owner, wrong status) keeps its
 * status and message, so the app sees what it always saw. A property service
 * that cannot be reached is a `503`, which the payment provider retries.
 */
@Injectable()
export class PropertyPublishingClient {
  private readonly client = new ServiceClient(
    'property',
    process.env.PROPERTY_SERVICE_URL || 'http://localhost:4003',
    'payment',
  );

  /** Checks that `userId` may publish the listing and parks it as Pending. Answers the status it had. */
  begin(
    userId: string,
    propertyId: string,
  ): Promise<{ previousStatus: string }> {
    return this.send(
      'POST',
      `/internal/properties/${propertyId}/begin-publish`,
      { userId },
    );
  }

  /** A paid listing goes live; an unpaid one returns to Draft. Repeating it is harmless. */
  settle(propertyId: string, outcome: PublishOutcome): Promise<void> {
    return this.send(
      'POST',
      `/internal/properties/${propertyId}/settle-publish`,
      { outcome },
    );
  }

  /** The payment could not be started: put the listing back as it was. */
  revert(propertyId: string, status: string): Promise<void> {
    return this.send(
      'POST',
      `/internal/properties/${propertyId}/revert-publish`,
      { status },
    );
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    try {
      return await this.client.call<T>(method, path, {
        body,
        timeoutMs: TIMEOUT_MS,
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

function toHttpException(error: unknown): unknown {
  if (!(error instanceof ServiceCallError)) return error;
  // 4xx: a rule of the property service said no. Anything else: it is not working.
  if (error.status >= 400 && error.status < 500)
    return new HttpException(error.message, error.status);
  return new ServiceUnavailableException(
    'Listings are unavailable right now. Please try again.',
  );
}
