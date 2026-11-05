'use strict';
const { randomUUID } = require('node:crypto');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Follow, block, report';

const person = (t, role) => ({ params: { id: t.userId(role) } });

module.exports = [
  {
    id: 'SOC-01',
    area: AREA,
    title: "Buyer follows the seller; the seller's listing appears in the Feed; unfollow",
    needs: ['published'],
    run: async (t) => {
      const followed = await t.call('buyer', 'PUT', '/users/:id/follow', { ...person(t, 'seller'), expect: 200 });
      t.check(followed.body.isFollowing === true, `isFollowing ${followed.body.isFollowing}`);
      const status = await t.call('buyer', 'GET', '/users/:id/follow', { ...person(t, 'seller'), expect: 200 });
      t.check(status.body.isFollowing === true && status.body.followerCount >= 1, `status ${JSON.stringify(status.body)}`);

      const feed = await t.call('buyer', 'GET', '/feed', { expect: 200 });
      t.check(Array.isArray(feed.body.items), 'feed has no items list');
      t.check(feed.body.items.some((item) => (item.id ?? item.property?.id) === t.state.listingId), "followed seller's listing not in the feed");

      await t.call('buyer', 'PUT', '/users/:id/follow', { ...person(t, 'buyer'), expect: 400, label: 'follow yourself' });
      await t.call('buyer', 'PUT', '/users/:id/follow', { params: { id: randomUUID() }, expect: 404, label: 'follow an unknown user' });
      const unfollowed = await t.call('buyer', 'DELETE', '/users/:id/follow', { ...person(t, 'seller'), expect: 200 });
      t.check(unfollowed.body.isFollowing === false, `isFollowing after unfollow ${unfollowed.body.isFollowing}`);
    },
  },
  {
    id: 'SOC-02',
    area: AREA,
    title: 'Block: listed under Blocked accounts, stops following and messaging; unblock',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('seller', 'PUT', '/users/:id/follow', { ...person(t, 'outsider'), expect: 200, label: 'seller follows outsider' });
      await t.call('outsider', 'PUT', '/users/:id/block', { ...person(t, 'seller'), expect: 200 });
      const mine = await t.call('outsider', 'GET', '/users/me/blocks', { expect: 200 });
      t.check(itemsOf(mine.body).some((b) => (b.id ?? b.userId) === t.userId('seller')), `blocked list ${JSON.stringify(mine.body).slice(0, 150)}`);
      const status = await t.call('outsider', 'GET', '/users/:id/block', { ...person(t, 'seller'), expect: 200 });
      t.check(status.body.isBlocked === true, `isBlocked ${status.body.isBlocked}`);
      const theirs = await t.call('seller', 'GET', '/users/:id/block', { ...person(t, 'outsider'), expect: 200, label: 'GET block status (as the blocked one)' });
      t.check(theirs.body.canMessage === false, `blocked seller canMessage ${theirs.body.canMessage}`);
      const follow = await t.call('seller', 'GET', '/users/:id/follow', { ...person(t, 'outsider'), expect: 200, label: 'follow status after block' });
      t.check(follow.body.isFollowing === false, 'blocking did not end the follow');
      await t.call('seller', 'PUT', '/users/:id/follow', { ...person(t, 'outsider'), expect: [403, 404], label: 'follow someone who blocked you' });
      await t.call('outsider', 'PUT', '/users/:id/block', { ...person(t, 'outsider'), expect: 400, label: 'block yourself' });

      await t.call('outsider', 'DELETE', '/users/:id/block', { ...person(t, 'seller'), expect: 200 });
      const after = await t.call('outsider', 'GET', '/users/me/blocks', { expect: 200, label: 'GET /users/me/blocks (after unblock)' });
      t.check(itemsOf(after.body).length === 0, 'still blocked after unblocking');
    },
  },
  {
    id: 'SOC-03',
    area: AREA,
    title: 'Reports: bad and impossible reports are refused, the queue is admin-only',
    needs: ['sessions'],
    run: async (t) => {
      // No real report is filed: it would stay in the admins' queue on production.
      const report = (body, expect, label) => t.call('buyer', 'POST', '/reports', { body, expect, label });
      await report({ targetType: 'user', targetId: t.userId('buyer'), reason: 'spam' }, 400, 'report yourself');
      await report({ targetType: 'listing', targetId: randomUUID(), reason: 'nonsense' }, 400, 'unknown reason');
      await report({ targetType: 'planet', targetId: randomUUID(), reason: 'spam' }, 400, 'unknown target type');
      await report({ targetType: 'listing', targetId: 'nope', reason: 'spam' }, 400, 'target not a uuid');
      await report({ targetType: 'listing', targetId: randomUUID(), reason: 'scam' }, 404, 'unknown listing');
      await report({ targetType: 'user', targetId: randomUUID(), reason: 'scam' }, 404, 'unknown user');
      await t.call('buyer', 'GET', '/reports/admin', { expect: 403, label: 'report queue as a normal user' });
      await t.call('buyer', 'PATCH', '/reports/admin/:id', { params: { id: randomUUID() }, body: { status: 'dismissed' }, expect: 403, label: 'review a report as a normal user' });
    },
  },
];
