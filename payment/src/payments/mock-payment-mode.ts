import { NotImplementedException } from '@nestjs/common';

export function mockPaymentsEnabled(): boolean {
  // Production builds may simulate only in an explicitly isolated staging environment.
  return (
    process.env.PAYMENT_MODE === 'mock' &&
    (process.env.NODE_ENV !== 'production' || process.env.APP_ENV === 'staging')
  );
}

export function requireMockPayments(): void {
  // The switch is server-owned; a client build flag cannot grant paid access.
  if (!mockPaymentsEnabled()) {
    throw new NotImplementedException({
      code: 'PAYMENTS_DISABLED',
      message: 'Payments are not available yet. Please try again later.',
    });
  }
}
