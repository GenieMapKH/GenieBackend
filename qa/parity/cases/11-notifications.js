'use strict';
const { randomUUID } = require('node:crypto');

const AREA = 'Notifications';
const PREFERENCE_KEYS = ['chatMessages', 'promotions', 'savedSearchAlerts', 'followedListings', 'savedListingUpdates'];

module.exports = [
  {
    id: 'NTF-01',
    area: AREA,
    title: 'Push device is registered and removed (as on sign-in / sign-out)',
    needs: ['sessions'],
    run: async (t) => {
      // A made-up token: the push service is never asked to deliver to it.
      const token = `qa-fake-fcm-token-${t.env.name}-${randomUUID()}`;
      await t.call('outsider', 'POST', '/notifications/devices', { body: { token, platform: 'android', locale: 'en' }, expect: [200, 201, 204] });
      await t.call('outsider', 'POST', '/notifications/devices', { body: { token, platform: 'android', locale: 'km' }, expect: [200, 201, 204], label: 'register again (locale change)' });
      await t.call('outsider', 'POST', '/notifications/devices', { body: { token, platform: 'blackberry' }, expect: 400, label: 'unknown platform' });
      await t.call('outsider', 'POST', '/notifications/devices', { body: { platform: 'android' }, expect: 400, label: 'no token' });
      await t.call('outsider', 'POST', '/notifications/devices/remove', { body: { token }, expect: [200, 201, 204] });
    },
  },
  {
    id: 'NTF-02',
    area: AREA,
    title: 'Notification settings: read, switch one off, switch it back',
    needs: ['sessions'],
    run: async (t) => {
      const before = await t.call('buyer', 'GET', '/notifications/preferences', { expect: 200 });
      for (const key of PREFERENCE_KEYS) t.check(typeof before.body[key] === 'boolean', `missing setting ${key}`);
      const off = await t.call('buyer', 'PATCH', '/notifications/preferences', { body: { promotions: false }, expect: 200 });
      t.check(off.body.promotions === false, 'promotions not switched off');
      t.check(off.body.chatMessages === before.body.chatMessages, 'another setting changed with it');
      const restored = await t.call('buyer', 'PATCH', '/notifications/preferences', { body: { promotions: before.body.promotions }, expect: 200, label: 'restore' });
      t.check(restored.body.promotions === before.body.promotions, 'not restored');
      await t.call('buyer', 'PATCH', '/notifications/preferences', { body: { promotions: 'yes' }, expect: 400, label: 'not a boolean' });
    },
  },
  {
    id: 'NTF-03',
    area: AREA,
    title: 'Sending a promotion is admin-only',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('buyer', 'POST', '/notifications/promotions', { body: { title: 'QA', body: 'QA' }, expect: 403 });
      await t.call('buyer', 'GET', '/notifications/promotions/:id', { params: { id: randomUUID() }, expect: 403 });
    },
  },
];
