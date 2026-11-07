'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ENVIRONMENTS, ROLES, passwordFor } = require('./lib/config');
const { ApiClient } = require('./lib/api-client');
const { newDeviceHeaders } = require('./lib/accounts');

// Existing QA accounts only. Login/logout create and revoke this check's session;
// no registration, listing/message writes, preference changes or payments.
async function check(env) {
  const api = new ApiClient(env.baseUrl);
  const checks = [];
  async function call(method, route, options, expected = 200) {
    const response = await api.request(method, route, options);
    const cacheControl = response.headers['cache-control'];
    checks.push({ method, route, status: response.status, expected, cacheControl });
    console.log(`${env.name}: ${method} ${route}: ${response.status}`);
    assert([].concat(expected).includes(response.status), `${env.name}: ${method} ${route}: expected ${expected}, received ${response.status}`);
    if (method === 'GET' && expected === 200) {
      assert(cacheControl?.includes('no-store'), `${env.name}: ${route} allows stale HTTP caching`);
    }
    return response;
  }

  const login = await call('POST', '/auth/login', {
    body: { phone: ROLES.seller.phone, password: passwordFor(env.name) },
    headers: newDeviceHeaders(),
  });
  const { accessToken, refreshToken } = login.body;
  assert(accessToken && refreshToken, 'Login did not return a token pair');
  const session = { token: accessToken };
  try {
    for (const route of [
      '/users/me', '/auth/sessions', '/properties?limit=1',
      '/properties/my/favorites?limit=1', '/chat/conversations?limit=1',
      '/notifications/preferences',
      '/public/properties/closest?lat=11.55&lng=104.92&limit=1',
    ]) await call('GET', route, session);

    const ice = await call('GET', '/chat/calls/ice-servers', session);
    assert(ice.body.iceServers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))), 'TURN relay missing');
    await call('GET', '/chat/backup', session, 404);
    // A missing listing is refused before a transaction or provider call is made.
    await call('POST', '/payments/checkout', {
      ...session, body: { propertyId: randomUUID(), requestId: randomUUID() },
    }, [404, 501]);

    const other = ENVIRONMENTS[env.name === 'staging' ? 'production' : 'staging'];
    const isolated = await new ApiClient(other.baseUrl).request('GET', '/users/me', session);
    checks.push({ method: 'GET', route: `${other.name}:/users/me`, status: isolated.status, expected: 401 });
    assert.equal(isolated.status, 401, `${env.name} token accepted by ${other.name}`);
  } finally {
    await call('POST', '/auth/logout', { body: { refreshToken } });
  }
  await call('GET', '/users/me', session, 401);
  return { environment: env.name, gateway: env.baseUrl, checks };
}

async function main() {
  const names = process.argv.slice(2);
  assert(names.length > 0 && names.every((n) => ENVIRONMENTS[n]), 'Usage: node check-live.js staging [production]');
  const environments = [];
  for (const name of names) environments.push(await check(ENVIRONMENTS[name]));
  const report = path.join(__dirname, 'reports', 'live-service-check.json');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify({ checkedAt: new Date().toISOString(), environments }, null, 2));
  console.log(`PASS: ${names.join(', ')}. Sanitized report: ${report}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
