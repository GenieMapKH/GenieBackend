'use strict';
const { QA_MARK } = require('./config');
const { itemsOf } = require('./json-search');

const ROLE_NAMES = ['seller', 'buyer', 'outsider'];

/**
 * Puts the QA accounts back to their resting state: no listings, saved
 * searches, search history, favourites, follows, blocks, conversations or
 * profile picture. Only the QA accounts' own data is touched. Run before the
 * cases (a crashed earlier run may have left something) and after them.
 * Answers what it removed, so a case can report it.
 */
async function resetQaData(t) {
  const removed = [];
  const roles = ROLE_NAMES.filter((role) => t.state.sessions?.[role]);

  for (const role of roles) {
    const listings = await t.call(role, 'GET', '/properties', { expect: 200 });
    for (const listing of itemsOf(listings.body)) {
      if (!String(listing.title ?? '').startsWith(QA_MARK) || listing.status === 'Deleted') continue;
      await t.call(role, 'DELETE', '/properties/:id', { params: { id: listing.id }, expect: [200, 204, 404] });
      removed.push(`${role} listing ${listing.id}`);
    }

    const saved = await t.call(role, 'GET', '/search/saved', { expect: 200 });
    for (const search of itemsOf(saved.body)) {
      if (!String(search.name ?? '').startsWith(QA_MARK)) continue;
      await t.call(role, 'DELETE', '/search/saved/:id', { params: { id: search.id }, expect: [200, 204, 404] });
      removed.push(`${role} saved search ${search.id}`);
    }

    const history = await t.call(role, 'GET', '/search/history', { expect: 200 });
    for (const entry of itemsOf(history.body)) {
      await t.call(role, 'DELETE', '/search/history/:id', { params: { id: entry.id }, expect: [200, 204, 404] });
      removed.push(`${role} search history ${entry.id}`);
    }

    const favorites = await t.call(role, 'GET', '/properties/my/favorites/ids', { expect: 200 });
    for (const id of itemsOf(favorites.body)) {
      await t.call(role, 'DELETE', '/properties/:id/favorite', { params: { id }, expect: [200, 204, 404] });
      removed.push(`${role} favourite ${id}`);
    }

    const blocks = await t.call(role, 'GET', '/users/me/blocks', { expect: 200 });
    for (const blocked of itemsOf(blocks.body)) {
      const id = blocked.id ?? blocked.userId ?? blocked.blockedId;
      if (!id) continue;
      await t.call(role, 'DELETE', '/users/:id/block', { params: { id }, expect: [200, 204] });
      removed.push(`${role} block of ${id}`);
    }

    await t.call(role, 'DELETE', '/users/me/avatar', { expect: [200, 204] });
  }

  for (const role of roles) {
    for (const other of roles) {
      if (other === role) continue;
      const otherId = t.userId(other);
      await t.call(role, 'DELETE', '/users/:id/follow', { params: { id: otherId }, expect: [200, 204] });
      if (role < other) {
        await t.call(role, 'POST', '/chat/conversations/:id/delete', {
          params: { id: otherId },
          body: { forEveryone: true },
          expect: [200, 201],
        });
      }
    }
  }
  return removed;
}

module.exports = { resetQaData };
