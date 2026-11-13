import { databaseConnectionOptions } from './database-connection-options';
import { X509Certificate } from 'node:crypto';
import { SUPABASE_ROOT_CA } from './supabase-ca';

describe('database transport security', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '[::1]',
    'postgres',
    'postgres.railway.internal',
  ])('keeps the explicit local/private fixture usable: %s', (host) => {
    expect(
      databaseConnectionOptions(`postgresql://fixture:fixture@${host}:5432/db`)
        .ssl,
    ).toBeUndefined();
  });
  it.each([
    '',
    '?ssl=0',
    '?sslmode=disable',
    '?sslmode=no-verify',
    '?sslmode=require&uselibpqcompat=true',
  ])(
    'never permits plaintext or unverified TLS on the public network: %s',
    (query) => {
      const options = databaseConnectionOptions(
        `postgresql://fixture:fixture@db.example:5432/db${query}`,
      );
      expect(options.ssl?.rejectUnauthorized).toBe(true);
      expect(options.connectionString).not.toMatch(/ssl|uselibpqcompat/);
    },
  );
  it('uses the provider CA only for actual Supabase hosts and retains hostname verification', () => {
    const trusted = databaseConnectionOptions(
      'postgresql://fixture:fixture@aws-0-ap-southeast-1.pooler.supabase.com:5432/db',
    );
    expect(trusted.ssl?.ca).toContain(SUPABASE_ROOT_CA);
    expect(
      databaseConnectionOptions(
        'postgresql://fixture:fixture@supabase.com.attacker.invalid/db',
      ).ssl?.ca,
    ).toBeUndefined();
    expect(
      new X509Certificate(SUPABASE_ROOT_CA).fingerprint256.replaceAll(':', ''),
    ).toBe('807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA');
    expect(trusted.ssl?.checkServerIdentity).toBeUndefined(); // Node's default hostname check, never bypassed.
  });
});
