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
