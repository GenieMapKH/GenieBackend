'use strict';
const { connectChat } = require('../lib/chat-socket');
const AREA = 'Chat';
const ROLES = ['seller', 'buyer', 'outsider'];

module.exports = [
  {
    id: 'CHT-01', area: AREA,
    title: 'Chat requires no PIN or device key setup; retired endpoints are unavailable',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('buyer', 'GET', '/chat/backup', { expect: 404 });
      await t.call('buyer', 'POST', '/chat/keys', { body: {}, expect: 404 });
      t.state.chatReady = true;
    },
  },
  {
    id: 'CHT-03',
    area: AREA,
    title: 'Chat socket: refuses no token, a forged token and an unknown API version; connects when signed in',
    needs: ['chatReady'],
    run: async (t) => {
      const noToken = await connectChat(t.env.baseUrl, {});
      t.record('socket connect (no token)', 'guest', noToken.error ?? 'connected', null);
      noToken.socket?.close();
      t.check(noToken.error === 'unauthorized', `no token gave ${noToken.error ?? 'a connection'}`);

      const forged = await connectChat(t.env.baseUrl, { token: 'forged' });
      t.record('socket connect (forged token)', 'guest', forged.error ?? 'connected', null);
      forged.socket?.close();
      t.check(forged.error === 'unauthorized', `forged token gave ${forged.error ?? 'a connection'}`);

      const future = await connectChat(t.env.baseUrl, { token: t.session('buyer').accessToken, apiVersion: '99' });
      t.record('socket connect (API version 99)', 'buyer', future.error ?? 'connected', null);
      future.socket?.close();
      t.check(future.error === 'api_version_unknown', `version 99 gave ${future.error ?? 'a connection'}`);

      t.state.sockets = {};
      for (const role of ROLES) {
        const connected = await connectChat(t.env.baseUrl, { token: t.session(role).accessToken });
        t.record(`socket connect (${role})`, role, connected.error ?? 'connected', null);
        t.check(connected.socket, `${role} could not connect: ${connected.error}`);
        t.state.sockets[role] = connected.socket;
      }
    },
  },
];
