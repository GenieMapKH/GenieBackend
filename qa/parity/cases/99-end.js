'use strict';
const { resetQaData } = require('../lib/cleanup');
const { itemsOf } = require('../lib/json-search');
const { QA_AREA } = require('../lib/config');

const AREA = 'Clean-up & sign-out';

module.exports = [
  {
    id: 'END-01',
    area: 'Listings',
    title: 'Seller removes the photo, then deletes the listing; it is gone everywhere',
    needs: ['listingId'],
    run: async (t) => {
      const params = { id: t.state.listingId };
      if (t.state.imageUrl) {
        const trimmed = await t.call('seller', 'POST', '/properties/:id/images/remove', { params, body: { urls: [t.state.imageUrl] }, expect: [200, 201] });
        t.check((trimmed.body.images ?? []).length === 0, 'photo still attached');
      }
      const removed = await t.call('seller', 'DELETE', '/properties/:id', { params, expect: 200 });
      t.check(removed.body.status === 'Deleted', `status ${removed.body.status}`);
      await t.call(null, 'GET', '/public/properties/:id', { params, expect: 404, label: 'detail as guest (deleted)' });
      await t.call('seller', 'GET', '/properties/:id', { params, expect: 404, label: 'detail as owner (deleted)' });
      const map = await t.call(null, 'GET', '/public/properties/map', { query: QA_AREA, expect: 200 });
      t.check(!itemsOf(map.body).some((p) => p.id === params.id), 'deleted listing still on the map');
      await t.call('seller', 'DELETE', '/properties/:id', { params, expect: 404, label: 'delete twice' });
      t.state.listingId = null;
    },
  },
  {
    id: 'END-02',
    area: AREA,
    title: 'All QA test data is removed (conversations, follows, favourites, saved searches...)',
    needs: ['sessions'],
    parity: 'outcome',
    run: async (t) => {
      const removed = await resetQaData(t);
      if (removed.length > 0) t.note(`Removed at the end: ${removed.join('; ')}`);
      const history = await t.call('seller', 'GET', '/chat/messages/:id', { params: { id: t.userId('buyer') }, expect: 200, label: 'chat history after clean-up' });
      const left = Array.isArray(history.body?.messages) ? history.body.messages : itemsOf(history.body);
      t.check(left.length === 0, `${left.length} chat messages left`);
    },
  },
  {
    id: 'END-03',
    area: 'Sign-in',
    title: 'Refresh rotates tokens; reusing an old refresh token signs every device out (theft protection)',
    needs: ['sessions'],
    run: async (t) => {
      const outsider = t.session('outsider');
      const rotated = await t.call(null, 'POST', '/auth/refresh', { body: { refreshToken: outsider.refreshToken }, headers: outsider.deviceHeaders, expect: 200 });
      t.check(rotated.body.accessToken && rotated.body.refreshToken !== outsider.refreshToken, 'no new token pair');
      await t.call(null, 'GET', '/users/me', { token: rotated.body.accessToken, expect: 200, label: 'new access token works' });
      await t.call(null, 'POST', '/auth/refresh', { body: { refreshToken: outsider.refreshToken }, expect: 401, label: 'reuse the old refresh token' });
      await t.call(null, 'POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken }, expect: 401, label: 'new refresh token after theft detection' });
      await t.call(null, 'GET', '/users/me', { token: rotated.body.accessToken, expect: 401, label: 'access token after theft detection' });
      delete t.state.sessions.outsider;
    },
  },
  {
    id: 'END-99',
    area: AREA,
    title: 'Seller and buyer sign out; their tokens stop working',
    needs: ['sessions'],
    run: async (t) => {
      for (const socket of Object.values(t.state.sockets ?? {})) socket.close();
      t.state.sockets = null;
      for (const role of ['seller', 'buyer']) {
        const session = t.state.sessions[role];
        if (!session) continue;
        await t.call(null, 'POST', '/auth/logout', { body: { refreshToken: session.refreshToken }, expect: 200, label: `logout (${role})` });
        await t.call(null, 'GET', '/users/me', { token: session.accessToken, expect: 401, label: `old token after logout (${role})` });
      }
    },
  },
];
