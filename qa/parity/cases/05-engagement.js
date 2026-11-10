'use strict';
const { randomUUID } = require('node:crypto');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Buyer actions';

const listing = (t) => ({ params: { id: t.state.listingId } });
const unknown = () => ({ params: { id: randomUUID() } });

async function totals(t, label) {
  const insights = await t.call('seller', 'GET', '/properties/:id/insights', { ...listing(t), expect: 200, label });
  t.check(insights.body.totals && Array.isArray(insights.body.days), `insights shape ${JSON.stringify(insights.body).slice(0, 120)}`);
  return insights.body.totals;
}

module.exports = [
  {
    id: 'ENG-01',
    area: AREA,
    title: 'Buyer likes and unlikes a listing',
    needs: ['published'],
    run: async (t) => {
      await t.call('buyer', 'POST', '/properties/:id/like', { ...listing(t), expect: 201 });
      await t.call('buyer', 'POST', '/properties/:id/like', { ...listing(t), expect: [200, 201, 409], label: 'like twice' });
      await t.call('buyer', 'DELETE', '/properties/:id/like', { ...listing(t), expect: 200 });
      await t.call('buyer', 'POST', '/properties/:id/like', { ...unknown(), expect: 404, label: 'like an unknown listing' });
    },
  },
  {
    id: 'ENG-02',
    area: AREA,
    title: 'Buyer saves a listing; it shows in Saved (ids, list, paged); unsaving removes it',
    needs: ['published'],
    run: async (t) => {
      const id = t.state.listingId;
      await t.call('buyer', 'POST', '/properties/:id/favorite', { ...listing(t), expect: 201 });
      const ids = await t.call('buyer', 'GET', '/properties/my/favorites/ids', { expect: 200 });
      t.check(itemsOf(ids.body).includes(id), 'not in favourite ids');
      const all = await t.call('buyer', 'GET', '/properties/my/favorites', { expect: 200, label: 'GET favourites (all)' });
      t.check(itemsOf(all.body).some((p) => (p.id ?? p.property?.id) === id), 'not in the favourites list');
      const page = await t.call('buyer', 'GET', '/properties/my/favorites', { query: { limit: 10 }, expect: 200, label: 'GET favourites (page)' });
      t.check(Array.isArray(page.body.items), 'paged favourites has no items');
      await t.call('buyer', 'GET', '/properties/my/favorites', { query: { limit: 10, sort: 'nonsense' }, expect: 400, label: 'GET favourites (bad sort)' });
      await t.call('buyer', 'DELETE', '/properties/:id/favorite', { ...listing(t), expect: 200 });
      const after = await t.call('buyer', 'GET', '/properties/my/favorites/ids', { expect: 200, label: 'GET favourite ids (after unsave)' });
      t.check(!itemsOf(after.body).includes(id), 'still a favourite after unsaving');
      await t.call('buyer', 'POST', '/properties/:id/favorite', { ...unknown(), expect: 404, label: 'save an unknown listing' });
    },
  },
  {
    id: 'ENG-03',
    area: AREA,
    title: "Views are counted for buyers, not for the owner's own visits",
    needs: ['published'],
    run: async (t) => {
      const before = await totals(t, 'insights before');
      await t.call('seller', 'POST', '/properties/:id/view', { ...listing(t), expect: 201, label: 'owner views own listing' });
      const afterOwner = await totals(t, 'insights after owner view');
      t.check(afterOwner.views === before.views, `owner view counted: ${before.views} -> ${afterOwner.views}`);
      await t.call('buyer', 'POST', '/properties/:id/view', { ...listing(t), expect: 201, label: 'buyer views listing' });
      const afterBuyer = await totals(t, 'insights after buyer view');
      t.check(afterBuyer.views === before.views + 1, `buyer view not counted: ${before.views} -> ${afterBuyer.views}`);
    },
  },
  {
    id: 'ENG-04',
    area: AREA,
    title: 'Call / Chat taps are recorded as leads for the owner',
    needs: ['published'],
    run: async (t) => {
      const before = await totals(t, 'insights before');
      await t.call('buyer', 'POST', '/properties/:id/lead', { ...listing(t), body: { channel: 'call' }, expect: 204, label: 'lead: call' });
      await t.call('buyer', 'POST', '/properties/:id/lead', { ...listing(t), body: { channel: 'chat' }, expect: 204, label: 'lead: chat' });
      await t.call('buyer', 'POST', '/properties/:id/lead', { ...listing(t), body: { channel: 'pigeon' }, expect: 400, label: 'lead: unknown channel' });
      await t.call('buyer', 'POST', '/properties/:id/lead', { ...unknown(), body: { channel: 'call' }, expect: 404, label: 'lead: unknown listing' });
      const after = await totals(t, 'insights after');
      t.check(after.calls >= 1 && after.chats >= 1, `leads not counted: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    },
  },
  {
    id: 'ENG-05',
    area: AREA,
    title: 'Contact form to the owner (and its validation)',
    needs: ['published'],
    run: async (t) => {
      await t.call('buyer', 'POST', '/properties/:id/contact', {
        ...listing(t),
        body: { name: 'QA Buyer', message: 'Automated test message, please ignore.' },
        expect: 201,
      });
      await t.call('buyer', 'POST', '/properties/:id/contact', { ...listing(t), body: { name: 'QA Buyer' }, expect: 400, label: 'contact: no message' });
      await t.call('buyer', 'POST', '/properties/:id/contact', {
        ...listing(t),
        body: { name: 'QA', message: 'x', email: 'not-an-email' },
        expect: 400,
        label: 'contact: bad email',
      });
    },
  },
  {
    id: 'ENG-06',
    area: AREA,
    title: 'Insights are for the owner only',
    needs: ['published'],
    run: async (t) => {
      const mine = await totals(t, 'insights as owner');
      t.check(typeof mine.views === 'number' && typeof mine.saves === 'number', `totals ${JSON.stringify(mine)}`);
      await t.call('buyer', 'GET', '/properties/:id/insights', { ...listing(t), expect: 404, label: 'insights as buyer' });
    },
  },
];
