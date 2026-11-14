'use strict';
const { randomUUID } = require('node:crypto');
const { ROLES, passwordFor } = require('../lib/config');

const AREA = 'Sign-in';

module.exports = [
  {
    id: 'AUTH-02',
    area: AREA,
    title: 'Registration refuses bad input and an existing phone',
    needs: ['sessions'],
    run: async (t) => {
      const password = passwordFor(t.env.name);
      await t.call(null, 'POST', '/auth/register', { body: { phone: 'not-a-phone', password }, expect: 400, label: 'register: bad phone' });
      await t.call(null, 'POST', '/auth/register', { body: { phone: '+12025550199', password: 'short' }, expect: 400, label: 'register: short password' });
      await t.call(null, 'POST', '/auth/register', { body: { password }, expect: 400, label: 'register: no phone' });
      await t.call(null, 'POST', '/auth/register', {
        body: { phone: '+12025550199', email: 'not-an-email', password },
        expect: 400,
        label: 'register: bad email',
      });
      await t.call(null, 'POST', '/auth/register', {
        body: { phone: ROLES.seller.phone, password },
        expect: 409,
        label: 'register: phone already used',
      });
    },
  },
  {
    id: 'AUTH-03',
    area: AREA,
    title: 'Login refuses a wrong password, an unknown phone and missing fields',
    needs: ['sessions'],
    run: async (t) => {
      await t.call(null, 'POST', '/auth/login', {
        body: { phone: ROLES.outsider.phone, password: 'definitely-wrong-password' },
        expect: 401,
        label: 'login: wrong password',
      });
      await t.call(null, 'POST', '/auth/login', {
        body: { phone: '+12025550198', password: 'whatever-password' },
        expect: 401,
        label: 'login: unknown phone',
      });
      await t.call(null, 'POST', '/auth/login', { body: { phone: ROLES.outsider.phone }, expect: 400, label: 'login: no password' });
      await t.call(null, 'POST', '/auth/login', { body: { password: 'x' }, expect: 400, label: 'login: no phone or email' });
      // Typed with spaces, as people do: it must still find the account.
      const spaced = ROLES.outsider.phone.replace(/^(\+1)(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3 $4');
      const login = await t.call(null, 'POST', '/auth/login', {
        body: { phone: spaced, password: passwordFor(t.env.name) },
        headers: t.session('outsider').deviceHeaders,
        expect: 200,
        label: 'login: phone with spaces',
      });
      // That sign-in opened a session of its own: close it again.
      await t.call(null, 'POST', '/auth/logout', {
        body: { refreshToken: login.body.refreshToken },
        expect: 200,
        label: 'logout the extra session',
      });
    },
  },
  {
    id: 'AUTH-04',
    area: AREA,
    title: 'Protected routes refuse no token, a forged token, and accept "bearer" in any case',
    needs: ['sessions'],
    run: async (t) => {
      await t.call(null, 'GET', '/users/me', { expect: 401, label: 'no token' });
      await t.call(null, 'GET', '/users/me', { token: 'not.a.jwt', expect: 401, label: 'forged token' });
      const token = t.session('buyer').accessToken;
      await t.call(null, 'GET', '/users/me', { token: '', headers: { Authorization: `bearer ${token}` }, expect: 200, label: 'lower-case bearer' });
      for (const path of ['/properties', '/chat/conversations', '/notifications/preferences', '/search/saved', '/feed']) {
        await t.call(null, 'GET', path, { expect: 401, label: `guest GET ${path}` });
      }
    },
  },
  {
    id: 'AUTH-05',
    area: AREA,
    title: 'Password reset: bad email OTPs are refused and the retired SMS reset route is unavailable',
    run: async (t) => {
      // A new address each run: reset requests are limited per address (1 a minute, 6 a day).
      const email = `qa-nobody-${randomUUID().slice(0, 8)}@example.com`;
      await t.call(null, 'POST', '/auth/forgot-password', { body: { email }, expect: 200, label: 'forgot-password: unknown email' });
      await t.call(null, 'POST', '/auth/forgot-password', { body: { email: 'nope' }, expect: 400, label: 'forgot-password: bad email' });
      await t.call(null, 'POST', '/auth/verify-otp', { body: { email, otp: '000000' }, expect: 400, label: 'verify-otp: wrong code' });
      await t.call(null, 'POST', '/auth/reset-password', {
        body: { email, otp: '000000', newPassword: 'another-password-1' },
        expect: 400,
        label: 'reset-password: wrong code',
      });
      await t.call(null, 'POST', '/auth/reset-password/phone', {
        body: { idToken: 'not-a-firebase-token', newPassword: 'another-password-1' },
        expect: 404,
        label: 'retired phone password-reset route stays unavailable',
      });
    },
  },
  {
    id: 'AUTH-06',
    area: AREA,
    title: 'Google (Firebase) sign-in refuses a forged token',
    run: async (t) => {
      await t.call(null, 'POST', '/auth/firebase-login', { body: { idToken: 'forged-token' }, expect: 401 });
      await t.call(null, 'POST', '/auth/firebase-login', { body: {}, expect: 400, label: 'firebase-login: no token' });
    },
  },
  {
    id: 'AUTH-07',
    area: AREA,
    title: 'Giving a Google account a password needs a fresh Google sign-in',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('buyer', 'POST', '/auth/account/password', {
        body: { idToken: 'forged-google-token', newPassword: 'another-password-1' },
        expect: [400, 401, 403],
        label: 'create password with a forged Google token',
      });
      await t.call('buyer', 'POST', '/auth/account/password', { body: { newPassword: 'short' }, expect: 400, label: 'create password: bad input' });
    },
  },
  {
    id: 'AUTH-08',
    area: AREA,
    title: 'Refresh and logout refuse forged refresh tokens',
    run: async (t) => {
      await t.call(null, 'POST', '/auth/refresh', { body: { refreshToken: 'forged' }, expect: 401 });
      await t.call(null, 'POST', '/auth/refresh', { body: {}, expect: 400, label: 'refresh: no token' });
      await t.call(null, 'POST', '/auth/logout', { body: { refreshToken: `forged-${randomUUID()}` }, expect: [200, 401] });
    },
  },
];
