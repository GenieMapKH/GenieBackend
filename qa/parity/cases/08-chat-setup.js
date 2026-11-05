'use strict';
const { identityKeyFor, passwordFor, pinVerifierFor } = require('../lib/config');
const { connectChat } = require('../lib/chat-socket');
const { backupFor, ensureChatPin } = require('../lib/chat-fixtures');

const AREA = 'Chat';
const ROLES = ['seller', 'buyer', 'outsider'];

module.exports = [
  {
    id: 'CHT-01',
    area: AREA,
    title: 'Every account publishes its chat key; others can fetch it',
    needs: ['sessions'],
    run: async (t) => {
      for (const role of ROLES) {
        await ensureChatPin(t, role);
        await t.call(role, 'POST', '/chat/keys', { body: { identityPublicKey: identityKeyFor(t.env.name, role) }, expect: [200, 201], label: `POST /chat/keys (${role})` });
      }
      const key = await t.call('buyer', 'GET', '/chat/keys/:id', { params: { id: t.userId('seller') }, expect: 200 });
      t.check(key.body.identityPublicKey === identityKeyFor(t.env.name, 'seller'), `fetched key ${JSON.stringify(key.body)}`);
      await t.call('buyer', 'POST', '/chat/keys', { body: { identityPublicKey: '' }, expect: 400, label: 'POST /chat/keys (empty)' });
      t.state.chatReady = true;
    },
  },
  {
    id: 'CHT-02',
    area: AREA,
    title: 'Chat PIN backup: describe, unlock with the right PIN, refuse a wrong one, replace only with proof',
    needs: ['chatReady'],
    run: async (t) => {
      const described = await t.call('buyer', 'GET', '/chat/backup', { expect: 200 });
      t.check(described.body.protectedBy === 'pin', `protectedBy ${described.body.protectedBy}`);
      const right = { backupVerifier: pinVerifierFor(t.env.name, 'buyer') };
      const opened = await t.call('buyer', 'POST', '/chat/backup/unlock', { body: right, expect: 200, label: 'unlock: right PIN' });
      t.check(opened.body.backupBlob === backupFor(t.env.name, 'buyer').backupBlob, 'unlocked a different backup');
      const wrong = await t.call('buyer', 'POST', '/chat/backup/unlock', { body: { backupVerifier: pinVerifierFor(t.env.name, 'buyer', 'wrong') }, expect: 403, label: 'unlock: wrong PIN' });
      t.check(typeof wrong.body.attemptsLeft === 'number', `no attemptsLeft: ${JSON.stringify(wrong.body)}`);
      await t.call('buyer', 'POST', '/chat/backup/unlock', { body: right, expect: 200, label: 'unlock: right PIN again (clears the count)' });
      await t.call('buyer', 'POST', '/chat/backup/unlock', { body: { backupVerifier: 'short' }, expect: 400, label: 'unlock: malformed proof' });

      const backup = backupFor(t.env.name, 'buyer');
      await t.call('buyer', 'POST', '/chat/backup', { body: backup, expect: 403, label: 'replace backup without proof' });
      await t.call('buyer', 'POST', '/chat/backup', { body: { ...backup, currentBackupVerifier: backup.backupVerifier }, expect: [200, 201], label: 'replace backup with the current PIN' });
    },
  },
  {
    id: 'CHT-11',
    area: AREA,
    title: 'Forgot chat PIN: the account password proves the owner, then keys and PIN are reset',
    needs: ['chatReady'],
    run: async (t) => {
      // The same key and backup are written back, so the account ends as it started.
      const backup = backupFor(t.env.name, 'outsider');
      const identityPublicKey = identityKeyFor(t.env.name, 'outsider');
      await t.call('outsider', 'POST', '/chat/keys/reset', { body: { ...backup, identityPublicKey }, expect: 403, label: 'reset keys without proof' });
      await t.call('outsider', 'POST', '/chat/keys/reset', {
        body: { ...backup, identityPublicKey, passwordProofToken: 'forged' },
        expect: 403,
        label: 'reset keys with a forged password proof',
      });
      const proof = await t.call('outsider', 'POST', '/auth/account/password-proof', { body: { password: passwordFor(t.env.name) }, expect: [200, 201] });
      const token = proof.body.token ?? proof.body.proofToken;
      await t.call('outsider', 'POST', '/chat/keys/reset', {
        body: { ...backup, identityPublicKey, passwordProofToken: token },
        expect: [200, 201],
        label: 'reset keys with the password proof',
      });
      await t.call('outsider', 'POST', '/chat/keys/reset', {
        body: { ...backup, identityPublicKey, currentBackupVerifier: backup.backupVerifier },
        expect: [200, 201],
        label: 'reset keys with the current PIN',
      });
      const key = await t.call('seller', 'GET', '/chat/keys/:id', { params: { id: t.userId('outsider') }, expect: 200 });
      t.check(key.body.identityPublicKey === identityPublicKey, 'key changed by the reset');
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
