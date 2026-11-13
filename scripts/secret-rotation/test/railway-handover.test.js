const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RailwayHandover } = require('../railway-handover');
const { SERVICES } = require('../layout');
const { FakeSecrets } = require('./fakes');
const { rotateSharedSecrets } = require('../rotate-shared');

test('handover waits for every active container, not only the newest deployment', async () => {
  let oldStillRunning = true;
  const handover = new RailwayHandover({ token: 'private', projectId: 'p', environmentId: 'prod',
    serviceIds: Object.fromEntries(SERVICES.map((s) => [s, s])), wait: async () => { oldStillRunning = false; },
    fetchImpl: async (_, options) => {
      const { query, variables } = JSON.parse(options.body);
      assert.equal(options.headers['project-access-token'], 'private');
      if (query.includes('serviceInstance(')) return Response.json({ data: { serviceInstance: {
        latestDeployment: { id: 'new', status: 'SUCCESS', projectId: 'p' },
        activeDeployments: [{ id: 'new', status: 'SUCCESS', projectId: 'p' },
          ...(oldStillRunning ? [{ id: 'old', status: 'SUCCESS', projectId: 'p' }] : [])],
      } } });
      return Response.json({ data: { deploymentSnapshot: { variablesRedacted: false,
        variables: { INTERNAL_SERVICE_SECRET: variables.id === 'old' ? 'old' : 'new' } } } });
    } });
  assert.equal(await handover.matches('user', { INTERNAL_SERVICE_SECRET: 'new' }), false);
  await handover.waitFor(['user'], { INTERNAL_SERVICE_SECRET: 'new' }, 2);
  assert.equal(oldStillRunning, false);
});

test('redacted snapshots and GraphQL errors cannot approve a handover', async () => {
  const handover = new RailwayHandover({ token: 't', projectId: 'p', environmentId: 'prod',
    serviceIds: Object.fromEntries(SERVICES.map((s) => [s, s])), fetchImpl: async () => Response.json({ errors: [{ message: 'private' }] }) });
  await assert.rejects(handover.matches('user', {}), /query failed/);
  handover.request = async (query) => query.includes('serviceInstance(')
    ? { serviceInstance: { latestDeployment: { id: 'a', status: 'SUCCESS' }, activeDeployments: [{ id: 'a', status: 'SUCCESS', projectId: 'p' }] } }
    : { deploymentSnapshot: { variablesRedacted: true, variables: {} } };
  assert.equal(await handover.matches('user', {}), false);
});

test('stalled shared-secret delivery leaves the signing secret and JWT encryption key intact', async () => {
  const old = 'old'.repeat(12);
  const secrets = new FakeSecrets({ '/:INTERNAL_SERVICE_SECRET': old,
    '/authentication:JWT_KEY_ENCRYPTION_KEY': 'existing-encryption-key' });
  let waits = 0;
  await assert.rejects(rotateSharedSecrets({ secrets, handover: { waitFor: async () => {
    if (++waits === 2) throw new Error('sync stalled');
  } } }), /sync stalled/);
  assert.equal(secrets.value('/', 'INTERNAL_SERVICE_SECRET'), old);
  assert.equal(secrets.value('/authentication', 'JWT_KEY_ENCRYPTION_KEY'), 'existing-encryption-key');
  assert.equal(secrets.value('/rotation', 'SHARED_ROTATED_AT'), null);
});

function recoveryFixture() {
  const shared = 'working'.repeat(6);
  const handover = new RailwayHandover({ token: 't', projectId: 'p', environmentId: 'prod',
    serviceIds: Object.fromEntries(SERVICES.map((s) => [s, s])) });
  const live = Object.fromEntries(SERVICES.map((s) => [s, {
    DATABASE_URL: `postgres://live-${s}`, INTERNAL_SERVICE_SECRET: shared,
    ...(s === 'authentication' ? { JWT_KEY_ENCRYPTION_KEY: 'live-encryption-key' } : {}),
  }]));
  handover.request = async (query, variables) => query.includes('serviceInstance(')
    ? { serviceInstance: { latestDeployment: { id: variables.serviceId, status: 'SUCCESS' },
      activeDeployments: [{ id: variables.serviceId, status: 'SUCCESS', projectId: 'p' }] } }
    : { deploymentSnapshot: { variables: live[variables.id], variablesRedacted: false } };
  const secrets = new FakeSecrets({ '/:INTERNAL_SERVICE_SECRET': 'unrelated-store-value' });
  return { handover, secrets, live, shared };
}

test('bootstrap reconciles drift to verified live credentials and is idempotent', async () => {
  const { handover, secrets, live, shared } = recoveryFixture();
  await handover.reconcile(secrets);
  assert.equal(secrets.value('/', 'INTERNAL_SERVICE_SECRET'), shared);
  for (const service of SERVICES) {
    for (const [key, value] of Object.entries(live[service])) assert.equal(secrets.value(`/${service}`, key), value);
  }
  await handover.preflight(secrets);
  secrets.writes.length = 0;
  await handover.reconcile(secrets);
  assert.deepEqual(secrets.writes, []);
});

test('bootstrap refuses inconsistent active services before any secret write', async () => {
  const { handover, secrets, live } = recoveryFixture();
  live.notification.INTERNAL_SERVICE_SECRET = 'different'.repeat(6);
  await assert.rejects(handover.reconcile(secrets), /do not share/);
  assert.deepEqual(secrets.writes, []);
});

test('bootstrap refuses unresolved snapshot references before writes', async () => {
  const { handover, secrets, live } = recoveryFixture();
  live.notification.INTERNAL_SERVICE_SECRET = '${{shared.INTERNAL_SERVICE_SECRET}}';
  await assert.rejects(handover.reconcile(secrets), /missing or inconsistent/);
  assert.deepEqual(secrets.writes, []);
});

test('bootstrap refuses invalid database URLs before writes', async () => {
  const { handover, secrets, live } = recoveryFixture();
  live.notification.DATABASE_URL = 'https://not-a-database.example';
  await assert.rejects(handover.reconcile(secrets), /DATABASE_URL is invalid/);
  assert.deepEqual(secrets.writes, []);
});

test('bootstrap reports failed healthchecks without writing or hiding the failure', async () => {
  const { handover, secrets } = recoveryFixture();
  handover.request = async () => ({ serviceInstance: { latestDeployment: { status: 'FAILED' }, activeDeployments: [] } });
  await assert.rejects(handover.reconcile(secrets), /FAILED; repair service startup\/healthchecks/);
  assert.deepEqual(secrets.writes, []);
});

test('bootstrap refuses redacted credentials and deployment changes before writes', async () => {
  const { handover, secrets } = recoveryFixture();
  const request = handover.request;
  handover.request = async (query, variables) => query.includes('serviceInstance(')
    ? request(query, variables) : { deploymentSnapshot: { variablesRedacted: true } };
  await assert.rejects(handover.reconcile(secrets), /redacted/);
  assert.deepEqual(secrets.writes, []);
  handover.request = request;
  handover.matches = async () => false;
  await assert.rejects(handover.reconcile(secrets), /deployment changed/);
  assert.deepEqual(secrets.writes, []);
});
