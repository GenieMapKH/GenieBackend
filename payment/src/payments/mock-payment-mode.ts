import { NotImplementedException } from '@nestjs/common';

export function mockPaymentsEnabled(): boolean {
  // Explicit server-side test mode; never inferred from a client or missing config.
  return ['mock', 'enabled'].includes(process.env.PAYMENT_MODE ?? '');
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
