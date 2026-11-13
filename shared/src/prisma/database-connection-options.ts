import { ConnectionOptions, rootCertificates } from 'node:tls';
import { isIP } from 'node:net';
import { SUPABASE_ROOT_CA } from './supabase-ca';

/** TLS is mandatory and verified outside the explicit loopback/private-service network. */
export function databaseConnectionOptions(connectionString: string): {
  connectionString: string;
  ssl?: ConnectionOptions;
} {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('A PostgreSQL URL is required');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local =
    host === 'localhost' ||
    host === '::1' ||
    (isIP(host) === 4 && host.startsWith('127.')) ||
    host === 'postgres' ||
    host.endsWith('.railway.internal');
  if (local) return { connectionString };
  // pg's URL SSL flags override the config object; remove every weakening flag first.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl') || key === 'uselibpqcompat')
      url.searchParams.delete(key);
  }
  const supabase =
    host.endsWith('.supabase.com') || host.endsWith('.supabase.co');
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(supabase && { ca: [...rootCertificates, SUPABASE_ROOT_CA] }),
    },
  };
}
