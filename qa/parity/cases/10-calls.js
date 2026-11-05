'use strict';
const { randomUUID } = require('node:crypto');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Calls';

/** Emits a call event as `role` and records the ack. */
async function emit(t, role, event, payload) {
  const ack = await t.state.sockets[role].emitAck(event, payload);
  t.record(event, role, ack?.status ?? 'no ack', ack);
  return ack;
}

/** Waits for `event` about `callId` on `role`'s socket and records whether it came. */
async function heard(t, role, event, callId) {
  const payload = await t.state.sockets[role].waitFor(event, (p) => p?.callId === callId);
  t.record(`${role} hears ${event}`, role, payload ? 'received' : 'missed', payload);
  t.check(payload, `${role} never heard ${event}`);
  return payload;
}

module.exports = [
  {
    id: 'CAL-01',
    area: AREA,
    title: 'Call relay (TURN) servers are handed out',
    needs: ['sessions'],
    run: async (t) => {
      const ice = await t.call('buyer', 'GET', '/chat/calls/ice-servers', { expect: 200 });
      const servers = ice.body.iceServers ?? [];
      t.check(servers.length > 0, 'no ICE servers');
      t.soft(servers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))), 'no TURN relay server (calls fail behind strict NATs)');
    },
  },
  {
    id: 'CAL-02',
    area: AREA,
    title: 'Voice call: invite, ring, accept, exchange signals, hang up, appears in call history',
    needs: ['sockets'],
    run: async (t) => {
      const callId = randomUUID();
      const invite = await emit(t, 'seller', 'call:invite', { callId, calleeId: t.userId('buyer') });
      t.check(invite.status === 'ok', `invite ${JSON.stringify(invite)}`);
      const ringing = await heard(t, 'buyer', 'call:incoming', callId);
      t.check(ringing.callerId === t.userId('seller'), `callerId ${ringing.callerId}`);

      t.check((await emit(t, 'buyer', 'call:accept', { callId })).status === 'ok', 'accept refused');
      await heard(t, 'seller', 'call:accepted', callId);
      t.check((await emit(t, 'seller', 'call:signal', { callId, type: 'offer', sdp: 'v=0 qa-offer' })).status === 'ok', 'offer refused');
      const offer = await heard(t, 'buyer', 'call:signal', callId);
      t.check(offer.sdp === 'v=0 qa-offer', 'offer changed in transit');
      t.check((await emit(t, 'buyer', 'call:signal', { callId, type: 'answer', sdp: 'v=0 qa-answer' })).status === 'ok', 'answer refused');
      await heard(t, 'seller', 'call:signal', callId);

      t.check((await emit(t, 'seller', 'call:hangup', { callId })).status === 'ok', 'hang up refused');
      await heard(t, 'buyer', 'call:ended', callId);

      const history = await t.call('buyer', 'GET', '/chat/calls/history', { query: { with: t.userId('seller') }, expect: 200 });
      t.check(itemsOf(history.body).some((c) => JSON.stringify(c).includes(callId)), 'call missing from history');
      await t.call('buyer', 'GET', '/chat/calls/history', { expect: 400, label: 'history without "with"' });
    },
  },
  {
    id: 'CAL-03',
    area: AREA,
    title: 'Declined call ends for the caller; calling someone who blocked you is refused',
    needs: ['sockets'],
    run: async (t) => {
      const callId = randomUUID();
      t.check((await emit(t, 'seller', 'call:invite', { callId, calleeId: t.userId('buyer') })).status === 'ok', 'invite refused');
      await heard(t, 'buyer', 'call:incoming', callId);
      t.check((await emit(t, 'buyer', 'call:decline', { callId })).status === 'ok', 'decline refused');
      const ended = await heard(t, 'seller', 'call:ended', callId);
      t.soft(ended.reason === 'declined', `reason ${ended.reason}`);

      await t.call('outsider', 'PUT', '/users/:id/block', { params: { id: t.userId('seller') }, expect: 200, label: 'outsider blocks seller' });
      const refused = await emit(t, 'seller', 'call:invite', { callId: randomUUID(), calleeId: t.userId('outsider') });
      await t.call('outsider', 'DELETE', '/users/:id/block', { params: { id: t.userId('seller') }, expect: 200, label: 'outsider unblocks seller' });
      t.check(refused.status === 'error', `invite to a blocker ${JSON.stringify(refused)}`);
      const malformed = await emit(t, 'seller', 'call:invite', { callId: 'x' });
      t.check(malformed.status === 'error', `malformed invite ${JSON.stringify(malformed)}`);
    },
  },
];
