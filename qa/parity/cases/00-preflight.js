'use strict';
const { signIn } = require('../lib/accounts');
const { resetQaData } = require('../lib/cleanup');

const AREA = 'Setup';

module.exports = [
  {
    id: 'ENV-01',
    area: AREA,
    title: 'Gateway answers its health check',
    run: async (t) => {
      await t.call(null, 'GET', '/health', { unversioned: true, expect: 200 });
    },
  },
  {
    id: 'ENV-02',
    area: AREA,
    title: 'Unknown API version is refused, unversioned paths still served (old app builds)',
    run: async (t) => {
      const unknown = await t.call(null, 'GET', '/v99/public/properties/closest', {
        unversioned: true,
        query: { lat: 11.55, lng: 104.92 },
      });
      t.check(unknown.status >= 400 && unknown.status < 500, `/v99 gave ${unknown.status}, expected a 4xx refusal`);
      await t.call(null, 'GET', '/public/properties/closest', {
        unversioned: true,
        query: { lat: 11.55, lng: 104.92 },
        expect: 200,
      });
    },
  },
  {
    id: 'AUTH-01',
    area: 'Sign-in',
    title: 'The 3 QA accounts sign in by phone + password (registered on the first run)',
    run: async (t) => {
      t.state.sessions = {};
      for (const role of ['seller', 'buyer', 'outsider']) {
        t.state.sessions[role] = await signIn(t, role);
      }
    },
  },
  {
    id: 'SETUP-01',
    area: AREA,
    title: 'Leftovers of earlier runs are removed (QA accounts only)',
    needs: ['sessions'],
    parity: 'outcome',
    run: async (t) => {
      const removed = await resetQaData(t);
      if (removed.length > 0) t.note(`Removed ${removed.length} leftovers: ${removed.join('; ')}`);
    },
  },
];
