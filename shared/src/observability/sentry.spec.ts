import * as Sentry from '@sentry/nestjs';
import { initSentry, withoutSecrets } from './sentry';

describe('initSentry', () => {
  const saved = process.env.SENTRY_DSN;
  afterEach(() => {
    process.env.SENTRY_DSN = saved;
  });

  it('starts nothing without a DSN', () => {
    const init = jest.spyOn(Sentry, 'init');
    delete process.env.SENTRY_DSN;

    expect(initSentry('property')).toBe(false);
    process.env.SENTRY_DSN = '   ';
    expect(initSentry('property')).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});

describe('withoutSecrets', () => {
  it('drops bodies, cookies, queries and session headers, and all but the user id', () => {
    const event = withoutSecrets({
      request: {
        url: 'https://gateway/auth/login',
        data: '{"password":"hunter2"}',
        cookies: { sid: 'x' },
        query_string: 'token=abc',
        headers: {
          Authorization: 'Bearer abc',
          'x-guest-session-id': 'g',
          'user-agent': 'Tilomnov/1.0',
        },
      },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    });

    expect(event.request).toEqual({
      url: 'https://gateway/auth/login',
      headers: { 'user-agent': 'Tilomnov/1.0' },
    });
    expect(event.user).toEqual({ id: 'u1' });
  });
});
