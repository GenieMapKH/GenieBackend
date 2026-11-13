// Prisma's CLI must use the same strict TLS policy as the application and rotation tools.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rootCertificates } = require('node:tls');
const { spawnSync } = require('node:child_process');
const { databaseConnectionOptions } = require('../../shared/dist/prisma/database-connection-options');

function cliConnection(url, certificatePath) {
  const options = databaseConnectionOptions(url);
  if (!options.ssl) return { url, ca: null };
  const parsed = new URL(options.connectionString);
  parsed.searchParams.set('sslmode', 'verify-full');
  parsed.searchParams.set('sslrootcert', certificatePath);
  return { url: parsed.toString(), ca: (options.ssl.ca || rootCertificates).join('\n') };
}

module.exports = { cliConnection };
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tilomnov-db-ca-'));
  try {
    const env = { ...process.env };
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      if (!env[key]) continue;
      const file = path.join(directory, `${key}.crt`);
      const prepared = cliConnection(env[key], file);
      if (prepared.ca) fs.writeFileSync(file, prepared.ca, { mode: 0o600 });
      env[key] = prepared.url;
    }
    const cli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');
    const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { env, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  } finally {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  }
}
