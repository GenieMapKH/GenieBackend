import { mockPaymentsEnabled, requireMockPayments } from './mock-payment-mode';

describe('payment environment gate', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    PAYMENT_MODE: process.env.PAYMENT_MODE,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it.each([undefined, '', 'unknown', 'disabled', 'mock'])(
    'production cannot simulate with mode %p',
    (mode) => {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_ENV;
      if (mode === undefined) delete process.env.PAYMENT_MODE;
      else process.env.PAYMENT_MODE = mode;
      expect(mockPaymentsEnabled()).toBe(false);
      expect(requireMockPayments).toThrow();
    },
  );
  it('requires explicit mock even outside production and allows isolated staging builds', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PAYMENT_MODE;
    expect(mockPaymentsEnabled()).toBe(false);
    process.env.PAYMENT_MODE = 'mock';
    expect(mockPaymentsEnabled()).toBe(true);
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'staging';
    expect(mockPaymentsEnabled()).toBe(true);
    process.env.APP_ENV = 'production';
    expect(mockPaymentsEnabled()).toBe(false);
  });
});
