import { buildCorsOptions } from './cors.config';

describe('buildCorsOptions', () => {
  it('uses the configured origin list', () => {
    const options = buildCorsOptions({
      CORS_ORIGINS: 'https://a.com, https://b.com',
    });

    expect(options.origin).toEqual(['https://a.com', 'https://b.com']);
  });

  it('allows any origin outside production when nothing is configured', () => {
    expect(buildCorsOptions({}).origin).toBe(true);
    expect(buildCorsOptions({ NODE_ENV: 'development' }).origin).toBe(true);
  });

  it('allows no browser origin in production when nothing is configured', () => {
    expect(buildCorsOptions({ NODE_ENV: 'production' }).origin).toBe(false);
  });

  it('lets a browser send the headers the app sets', () => {
    const allowed = String(buildCorsOptions({}).allowedHeaders)
      .toLowerCase()
      .split(',');

    for (const header of [
      'x-device-name',
      'x-device-platform',
      'x-guest-session-id',
      'if-none-match',
    ]) {
      expect(allowed).toContain(header);
    }
  });

  it('lets a browser read the ETag of an answer', () => {
    expect(buildCorsOptions({}).exposedHeaders).toBe('ETag');
  });

  it('never lets a client set x-user-id', () => {
    expect(String(buildCorsOptions({}).allowedHeaders)).not.toMatch(
      /x-user-id/i,
    );
  });
});
