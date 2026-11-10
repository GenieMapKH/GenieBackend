import { NotImplementedException } from '@nestjs/common';

export function mockPaymentsEnabled(): boolean {
  // shortcut: mock checkout is the default until verified bank payments are integrated.
  return (process.env.PAYMENT_MODE ?? 'mock') === 'mock';
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
