'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ROLES } = require('../lib/config');

const AREA = 'Profile';
const TINY_JPEG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tiny.jpg'));
const SECRET_FIELDS = ['passwordHash', 'password_hash', 'password', 'refreshToken'];

/** Fixed per account, so every run leaves the profile exactly as it found it. */
const PROFILE = {
  seller: { username: 'tqa_seller_0171', firstName: 'QA', lastName: 'Seller', sex: 'other' },
  buyer: { username: 'tqa_buyer_0172', firstName: 'QA', lastName: 'Buyer', sex: 'other' },
};

module.exports = [
  {
    id: 'PRO-01',
    area: AREA,
    title: 'Own profile is read back with the phone it was registered with',
    needs: ['sessions'],
    run: async (t) => {
      const me = await t.call('seller', 'GET', '/users/me', { expect: 200 });
      t.check(me.body.phone === ROLES.seller.phone, `phone is ${me.body.phone}`);
      t.check(me.body.hasPassword === true, 'hasPassword should be true');
      for (const field of SECRET_FIELDS) t.soft(!(field in me.body), `GET /users/me exposes ${field}`);
    },
  },
  {
    id: 'PRO-02',
    area: AREA,
    title: 'Edit profile: name, first/last name, sex and username are saved',
    needs: ['sessions'],
    run: async (t) => {
      for (const role of ['seller', 'buyer']) {
        const wanted = { ...PROFILE[role], name: ROLES[role].name };
        const saved = await t.call(role, 'PATCH', '/users/me', { body: wanted, expect: 200 });
        for (const [key, value] of Object.entries(wanted)) {
          t.soft(saved.body[key] === value, `${role}: ${key} saved as ${saved.body[key]}, wanted ${value}`);
        }
      }
      const reread = await t.call('seller', 'GET', '/users/me', { expect: 200 });
      t.check(reread.body.username === PROFILE.seller.username, 'username not kept on re-read');
    },
  },
  {
    id: 'PRO-03',
    area: AREA,
    title: 'Profile edits with bad values are refused',
    needs: ['sessions'],
    run: async (t) => {
      const bad = [
        ['username too short', { username: 'ab' }],
        ['username with spaces', { username: 'has space' }],
        ['name over 60 characters', { name: 'x'.repeat(61) }],
        ['unknown sex', { sex: 'unknown' }],
        ['bad phone', { phone: 'not-a-phone' }],
      ];
      for (const [label, body] of bad) {
        await t.call('seller', 'PATCH', '/users/me', { body, expect: 400, label: `PATCH /users/me: ${label}` });
      }
      await t.call('buyer', 'PATCH', '/users/me', {
        body: { username: PROFILE.seller.username },
        expect: 409,
        label: "PATCH /users/me: someone else's username",
      });
    },
  },
  {
    id: 'PRO-04',
    area: AREA,
    title: 'Username availability check',
    needs: ['sessions'],
    run: async (t) => {
      const taken = await t.call('buyer', 'GET', '/users/username-available', {
        query: { username: PROFILE.seller.username },
        expect: 200,
        label: 'taken username',
      });
      t.check(taken.body.available === false, `taken username reported available: ${JSON.stringify(taken.body)}`);
      const free = await t.call('buyer', 'GET', '/users/username-available', {
        query: { username: `tqa_free_${Date.now().toString(36)}` },
        expect: 200,
        label: 'free username',
      });
      t.check(free.body.available === true, `free username reported taken: ${JSON.stringify(free.body)}`);
      const own = await t.call('seller', 'GET', '/users/username-available', {
        query: { username: PROFILE.seller.username },
        expect: 200,
        label: 'own username',
      });
      t.check(own.body.available === true, `own username should count as available: ${JSON.stringify(own.body)}`);
    },
  },
  {
    id: 'PRO-05',
    area: AREA,
    title: "Another user's public profile shows no private fields; unknown ids are refused",
    needs: ['sessions'],
    run: async (t) => {
      const profile = await t.call('buyer', 'GET', '/users/:id', { params: { id: t.userId('seller') }, expect: 200 });
      t.check(profile.body.id === t.userId('seller'), 'wrong profile returned');
      for (const field of [...SECRET_FIELDS, 'firebaseUid', 'email', 'phone']) {
        t.soft(!(field in profile.body), `public profile exposes ${field}`);
      }
      await t.call('buyer', 'GET', '/users/:id', { params: { id: randomUUID() }, expect: 404, label: 'GET /users/:id (unknown)' });
      await t.call('buyer', 'GET', '/users/:id', { params: { id: 'not-a-uuid' }, expect: 400, label: 'GET /users/:id (not a uuid)' });
    },
  },
  {
    id: 'PRO-06',
    area: AREA,
    title: 'Profile picture: upload, use, fetch, remove',
    needs: ['sessions'],
    run: async (t) => {
      const slot = await t.call('seller', 'POST', '/users/me/avatar/upload', { expect: 201 });
      t.check(slot.body.path && slot.body.uploadUrl, 'no upload slot');
      const upload = await t.api.upload(slot.body.uploadUrl, TINY_JPEG, 'image/jpeg');
      t.record('upload avatar to storage', 'seller', upload.status, null);
      t.check(upload.status === 200, `storage upload gave ${upload.status}`);

      const used = await t.call('seller', 'PUT', '/users/me/avatar', { body: { path: slot.body.path }, expect: 200 });
      const avatarUrl = used.body.avatarUrl;
      t.check(typeof avatarUrl === 'string' && avatarUrl.startsWith('https://'), `avatarUrl is ${avatarUrl}`);
      const image = await fetch(avatarUrl);
      t.record('download avatar', 'guest', image.status, null);
      t.check(image.ok, `avatar URL answers ${image.status}`);

      await t.call('seller', 'PUT', '/users/me/avatar', { body: { path: `${randomUUID()}/x` }, expect: [400, 403, 404], label: "PUT /users/me/avatar (someone else's path)" });
      await t.call('seller', 'PUT', '/users/me/avatar/google', { body: { photoUrl: 'http://example.com/a.jpg' }, expect: 400, label: 'PUT /users/me/avatar/google (not https)' });

      const removed = await t.call('seller', 'DELETE', '/users/me/avatar', { expect: [200, 204] });
      const after = await t.call('seller', 'GET', '/users/me', { expect: 200, label: 'GET /users/me (after removal)' });
      t.check(after.body.avatarUrl === null, `avatar still set after removal (${removed.status})`);
    },
  },
];
