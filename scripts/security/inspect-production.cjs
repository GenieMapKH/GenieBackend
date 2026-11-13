// Read-only provider inspection. Never serialize raw provider variables or credentials.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { databaseConnectionOptions } = require('../../shared/dist/prisma/database-connection-options');

const project = '6c31c542-9708-4453-854b-3bc730744229';
const environment = 'f3ab82d3-a543-4852-8df6-681c8e73678c';
const cli = process.platform === 'win32' ? path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe') : 'railway';
function railway(args) {
  return JSON.parse(execFileSync(cli, [...args, '--project', project, '--environment', environment, '--json'], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

async function inspect() {
  const result = { checkedAt: new Date().toISOString(), project, environment, changesMade: false };
  const status = railway(['status']);
  const env = status.environments.edges.find(({ node }) => node.id === environment).node;
  result.ingress = env.serviceInstances.edges.map(({ node }) => ({
    service: node.serviceName,
    domains: [...node.domains.customDomains, ...node.domains.serviceDomains].map(({ domain }) => domain),
    tcpProxies: railway(['tcp-proxy', 'list', '--service', node.serviceId]).proxies,
    deployedCommit: node.activeDeployments.map(({ id, meta }) => ({ id, commit: meta?.commitHash ?? null })),
  }));
  const gateway = railway(['variables', '--service', 'Gateway']);
  result.gateway = Object.fromEntries(['NODE_ENV', 'APP_ENV', 'CORS_ORIGINS', 'TRUSTED_PROXIES', 'AUTH_SERVICE_URL'].map((key) => [key, gateway[key] ?? null]));
  const payment = railway(['variables', '--service', 'payment']);
  result.payments = Object.fromEntries(['NODE_ENV', 'APP_ENV', 'PAYMENT_MODE'].map((key) => [key, payment[key] ?? null]));
  result.corsProbes = [];
  for (const requestPath of ['/health', '/v1/public/properties/map']) {
    for (const origin of ['https://untrusted.invalid', 'null']) {
      try {
        const response = await fetch(`https://tilomnovgateway.sparkbytekh.com${requestPath}`, {
          method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-user-id' },
          redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        result.corsProbes.push({ requestPath, origin, status: response.status, allowOrigin: response.headers.get('access-control-allow-origin'), allowCredentials: response.headers.get('access-control-allow-credentials') });
      } catch (error) { result.corsProbes.push({ requestPath, origin, error: error.name }); }
    }
  }
  const authentication = railway(['variables', '--service', 'Authentication']);
  const userService = railway(['variables', '--service', 'Users']);
  if (userService.SUPABASE_URL && userService.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const storage = createClient(userService.SUPABASE_URL, userService.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await storage.storage.listBuckets();
      if (error) throw error;
      result.buckets = data.map(({ name, public: isPublic, file_size_limit, allowed_mime_types }) => ({ name, public: isPublic, fileSizeLimit: file_size_limit, allowedMimeTypes: allowed_mime_types }));
    } catch (error) { result.buckets = { unavailable: error.name }; }
  }
  result.database = {};
  async function readDatabase(label, connectionString, queries) {
    if (!connectionString) return;
    const client = new Client({ ...databaseConnectionOptions(connectionString), connectionTimeoutMillis: 10000, statement_timeout: 10000 });
    const target = new URL(connectionString);
    const observations = { target: {host: target.hostname, port: target.port || '5432', database: target.pathname} };
    try {
      await client.connect();
      observations.clientTLS = {encrypted: client.connection.stream.encrypted === true, authorized: client.connection.stream.authorized === true};
      await client.query('BEGIN READ ONLY');
      for (const [name, sql] of Object.entries(queries)) {
        await client.query('SAVEPOINT inspection');
        try { observations[name] = (await client.query(sql)).rows; }
        catch (error) { observations[name] = {unavailable: error.code || error.name}; await client.query('ROLLBACK TO SAVEPOINT inspection'); }
        await client.query('RELEASE SAVEPOINT inspection');
      }
    } catch (error) { observations.unavailable = error.code || error.name; }
    finally { await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}); }
    result.database[label] = observations;
  }
  await readDatabase('authentication', authentication.DATABASE_URL, {
    connection: 'SELECT current_user AS role, current_database() AS database, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()',
    grants: `SELECT r AS role, has_column_privilege(r,'account.users','password_hash','SELECT') AS reads_password_hash,
      has_column_privilege(r,'account.users','role','UPDATE') AS updates_role,
      has_column_privilege(r,'account.users','password_hash','UPDATE') AS updates_password
      FROM unnest(ARRAY['user_service','property_service','chat_service','notification_service','payment_service']) AS r`,
    apiRolePrivileges: `SELECT r.rolname AS role, n.nspname || '.' || c.relname AS table,
      has_any_column_privilege(r.oid,c.oid,'SELECT') AS reads_any_column,
      has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE') AS writes_rows
      FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE r.rolname IN ('anon','authenticated') AND (n.nspname,c.relname) IN
      (('account','users'),('account','refresh_tokens'),('payment','payment_transactions'))
      ORDER BY r.rolname,n.nspname,c.relname`,
    storagePolicies: `SELECT policyname, roles, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname`,
  });
  await readDatabase('payment', payment.DATABASE_URL, {
    connection: 'SELECT current_user AS role, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()',
    counts: 'SELECT provider, status, count(*)::int AS count FROM payment.payment_transactions GROUP BY provider,status ORDER BY provider,status',
  });
  try {
    const response = await fetch('https://tilomnovgateway.sparkbytekh.com/v1/auth/.well-known/jwks.json', {signal: AbortSignal.timeout(10000)});
    const body = await response.json();
    result.signingKeys = {status: response.status, algorithms: body.keys?.map(({kty, alg}) => ({kty, alg}))};
  } catch (error) { result.signingKeys = {unavailable: error.name}; }
  const out = 'docs/security-remediation-2026-11-13/provider-inspection.json';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}
inspect().catch((error) => { console.error('Read-only inspection failed:', error.code || error.name); process.exitCode = 1; });
