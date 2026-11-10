'use strict';
const { passwordFor } = require('../lib/config');
const { signIn } = require('../lib/accounts');

const AREA = 'Account & sessions';

/** The session id (`sid`) inside an access token. */
function sessionIdOf(accessToken) {
  return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).sid;
}

module.exports = [
  {
    id: 'ACC-01',
    area: AREA,
    title: 'Signed-in devices list marks this device, and a day-old device rule applies',
    needs: ['sessions'],
    run: async (t) => {
      const list = await t.call('seller', 'GET', '/auth/sessions', { expect: 200 });
      const sessions = list.body.sessions ?? [];
      t.check(sessions.filter((s) => s.current).length === 1, 'not exactly one current session');
      t.check(list.body.canSignOutOthers === false, 'a new device may sign out others');
      for (const field of ['token', 'tokenHash', 'token_hash']) {
        t.soft(!sessions.some((s) => field in s), `session list exposes ${field}`);
      }
    },
  },
  {
    id: 'ACC-02',
    area: AREA,
    title: 'Sensitive changes are refused on a device signed in less than a day ago (DEVICE_TOO_NEW)',
    needs: ['sessions'],
    run: async (t) => {
      const password = passwordFor(t.env.name);
      const tooNew = async (path, body, label) => {
        const response = await t.call('seller', 'POST', path, { body, expect: 403, label });
        t.check(response.body.code === 'DEVICE_TOO_NEW', `${label}: code ${response.body.code}`);
      };
      await tooNew('/auth/change-password', { currentPassword: password, newPassword: `${password}-x` }, 'change password');
      await tooNew('/auth/account/email', { email: 'qa-seller@example.com', password }, 'add an email');
      await tooNew('/auth/account/deactivate', { password }, 'deactivate account');
      await tooNew('/auth/account/delete', { password }, 'delete account');
      await t.call('seller', 'POST', '/auth/logout-all', { expect: 403, label: 'sign out all other devices' });
    },
  },
  {
    id: 'ACC-03',
    area: AREA,
    title: 'Password verification: wrong password refused, right one gives a short-lived proof',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('seller', 'POST', '/auth/account/password-proof', { body: { password: 'wrong-password' }, expect: [401, 403], label: 'wrong password' });
      const proof = await t.call('seller', 'POST', '/auth/account/password-proof', { body: { password: passwordFor(t.env.name) }, expect: [200, 201], label: 'right password' });
      t.check(typeof (proof.body.token ?? proof.body.proofToken) === 'string', `no token: ${JSON.stringify(proof.body).slice(0, 100)}`);
    },
  },
  {
    id: 'ACC-04',
    area: AREA,
    title: 'A new device cannot sign out another one; a device that signs itself out stops working at once',
    needs: ['sessions'],
    run: async (t) => {
      const second = await signIn(t, 'seller');
      const secondId = sessionIdOf(second.accessToken);
      const list = await t.call('seller', 'GET', '/auth/sessions', { expect: 200, label: 'GET /auth/sessions (two devices)' });
      t.check((list.body.sessions ?? []).some((s) => s.id === secondId && !s.current), 'second device not listed');
      const refused = await t.call('seller', 'DELETE', '/auth/sessions/:id', { params: { id: secondId }, expect: 403, label: 'sign out another device (from a new device)' });
      t.check(refused.body.code === 'DEVICE_TOO_NEW', `code ${refused.body.code}`);

      await t.call(null, 'POST', '/auth/logout', { body: { refreshToken: second.refreshToken }, expect: 200, label: 'second device signs itself out' });
      const after = await t.call(null, 'GET', '/users/me', { token: second.accessToken, label: 'signed-out device calls the API' });
      t.check(after.status === 401, `signed-out device still served (${after.status})`);
      await t.call(null, 'POST', '/auth/refresh', { body: { refreshToken: second.refreshToken }, expect: 401, label: 'signed-out device refreshes' });
      const still = await t.call('seller', 'GET', '/users/me', { expect: 200, label: 'first device still signed in' });
      t.check(still.body.id === t.userId('seller'), 'first device lost its session');
    },
  },
];
