'use strict';
const { randomUUID } = require('node:crypto');
const { ROLES, passwordFor } = require('./config');
const { CheckFailure, brief } = require('./case-context');

/** What the app sends with every request. A new device key per run: each run is a new device. */
function newDeviceHeaders() {
  return {
    'X-Device-Name': 'Tilomnov QA runner',
    'X-Device-Platform': 'android',
    'X-Device-Key': randomUUID(),
  };
}

/**
 * Registers the account the first time the suite meets this environment.
 * Not recorded as a step: it happens on one run only, and would make the
 * first run's record differ from every later one.
 */
async function registerOnce(t, role, password) {
  const { phone, name } = ROLES[role];
  const response = await t.api.request('POST', '/auth/register', {
    body: { phone, name, password },
  });
  if (response.status === 201) {
    t.note(`${role}: registered ${phone} (first run on this environment)`);
    return;
  }
  throw new CheckFailure(
    `${role}: cannot sign in and cannot register ${phone}: ${response.status} ${brief(response.body)}. ` +
      'If the number exists with another password, set QA_PASSWORD_* to the right one.',
  );
}

/** Signs one QA account in by phone, as the app does, and keeps its session in `t.state.sessions`. */
async function signIn(t, role, { record = true } = {}) {
  const password = passwordFor(t.env.name);
  const deviceHeaders = newDeviceHeaders();
  const login = () =>
    record
      ? t.call(null, 'POST', '/auth/login', {
          body: { phone: ROLES[role].phone, password },
          headers: deviceHeaders,
          label: `POST /auth/login (${role})`,
        })
      : t.api.request('POST', '/auth/login', {
          body: { phone: ROLES[role].phone, password },
          headers: deviceHeaders,
        });

  let response = await login();
  if (response.status === 401) {
    await registerOnce(t, role, password);
    if (record) t.steps.pop(); // The refused first try is not part of the comparison.
    response = await login();
  }
  t.check(response.status === 200, `${role}: login gave ${response.status} ${brief(response.body)}`);
  const { accessToken, refreshToken } = response.body ?? {};
  t.check(accessToken && refreshToken, `${role}: login answer has no token pair`);

  const me = await t.api.request('GET', '/users/me', {
    token: accessToken,
    headers: deviceHeaders,
  });
  t.check(me.status === 200 && me.body?.id, `${role}: GET /users/me gave ${me.status}`);
  return { role, userId: me.body.id, accessToken, refreshToken, deviceHeaders };
}

module.exports = { signIn, newDeviceHeaders };
