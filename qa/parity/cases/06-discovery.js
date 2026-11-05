'use strict';
const { randomUUID } = require('node:crypto');
const { QA_MARK, QA_AREA } = require('../lib/config');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Search & discovery';
const PHNOM_PENH = { minLat: 11.45, maxLat: 11.65, minLng: 104.8, maxLng: 105.0 };

module.exports = [
  {
    id: 'DSC-01',
    area: AREA,
    title: 'Guest browses the Phnom Penh map, with type/price filters; bad areas are refused',
    run: async (t) => {
      const map = await t.call(null, 'GET', '/public/properties/map', { query: PHNOM_PENH, expect: 200 });
      t.check(Array.isArray(map.body), 'map answer is not a list');
      await t.call(null, 'GET', '/public/properties/map', { query: { ...PHNOM_PENH, propertyType: 'Land', listingType: 'Sale' }, expect: 200, label: 'map: land for sale' });
      await t.call(null, 'GET', '/public/properties/map', { query: { ...PHNOM_PENH, minPrice: 50000, maxPrice: 150000 }, expect: 200, label: 'map: price range' });
      await t.call(null, 'GET', '/public/properties/map/prices', { query: { ...PHNOM_PENH, upTo: 500000 }, expect: 200, label: 'price histogram' });
      await t.call(null, 'GET', '/public/properties/map', { query: { ...PHNOM_PENH, minLat: 200 }, expect: 400, label: 'map: latitude 200' });
      await t.call(null, 'GET', '/public/properties/map', { expect: 400, label: 'map: no area' });
      await t.call(null, 'GET', '/public/properties/map/prices', { query: PHNOM_PENH, expect: 400, label: 'price histogram: no upTo' });
    },
  },
  {
    id: 'DSC-02',
    area: AREA,
    title: 'Closest listings to a point (the map pull-up sheet)',
    run: async (t) => {
      const closest = await t.call(null, 'GET', '/public/properties/closest', { query: { lat: 11.5564, lng: 104.9282 }, expect: 200 });
      const items = itemsOf(closest.body);
      t.check(items.every((item, i) => i === 0 || item.distanceMeters >= items[i - 1].distanceMeters), 'not sorted by distance');
      await t.call(null, 'GET', '/public/properties/closest', { query: { lat: 'x', lng: 104.9 }, expect: 400, label: 'closest: bad latitude' });
    },
  },
  {
    id: 'DSC-03',
    area: AREA,
    title: 'Guest session is registered for a device id',
    run: async (t) => {
      const session = await t.call(null, 'POST', '/public/properties/guest-session', { body: { deviceId: `qa-runner-${t.env.name}` }, expect: 201 });
      t.check(session.body.success === true, `guest session ${JSON.stringify(session.body)}`);
    },
  },
  {
    id: 'DSC-04',
    area: AREA,
    title: 'Home search finds places (Google), listings and people; empty query refused',
    needs: ['sessions'],
    run: async (t) => {
      const result = await t.call(null, 'GET', '/public/search', { query: { q: 'Toul Kork', lang: 'en' }, expect: 200 });
      for (const key of ['places', 'properties', 'people']) t.check(Array.isArray(result.body[key]), `no ${key} list`);
      t.soft(result.body.places.length > 0, 'Google place search found nothing for "Toul Kork" (is GOOGLE_PLACES_API_KEY set?)');
      const placeId = result.body.places[0]?.placeId;
      if (placeId) {
        const place = await t.call(null, 'GET', '/public/search/places/:placeId', { params: { placeId }, query: { lang: 'en' }, expect: 200 });
        t.soft(typeof place.body.place?.center?.lat === 'number', `place has no coordinates: ${JSON.stringify(place.body).slice(0, 150)}`);
      }
      await t.call(null, 'GET', '/public/search', { query: { q: '' }, expect: 400, label: 'search: empty query' });
      const people = await t.call('buyer', 'GET', '/public/search', { query: { q: 'Tilomnov QA Seller' }, expect: 200, label: 'search for the seller by name' });
      t.soft(itemsOf(people.body.people).some((p) => p.id === t.userId('seller')), 'seller not found by name');
    },
  },
  {
    id: 'DSC-05',
    area: AREA,
    title: "Publisher page: a person's public profile with their live listings",
    needs: ['published'],
    run: async (t) => {
      const page = await t.call(null, 'GET', '/public/search/people/:id', { params: { id: t.userId('seller') }, expect: 200 });
      t.check(page.body.person?.id === t.userId('seller'), 'wrong person');
      t.check(itemsOf(page.body.properties).some((p) => p.id === t.state.listingId), 'live listing missing from the publisher page');
      await t.call(null, 'GET', '/public/search/people/:id', { params: { id: randomUUID() }, expect: 404, label: 'unknown person' });
    },
  },
  {
    id: 'DSC-06',
    area: AREA,
    title: 'Recent searches: record, list, delete',
    needs: ['sessions'],
    run: async (t) => {
      const saved = await t.call('buyer', 'POST', '/search/history', { body: { query: 'QA automated search' }, expect: [200, 201] });
      const list = await t.call('buyer', 'GET', '/search/history', { expect: 200 });
      const entry = itemsOf(list.body).find((e) => e.query === 'QA automated search');
      t.check(entry, `recorded search missing (saved ${JSON.stringify(saved.body)})`);
      await t.call('buyer', 'DELETE', '/search/history/:id', { params: { id: entry.id }, expect: [200, 204] });
      const after = await t.call('buyer', 'GET', '/search/history', { expect: 200, label: 'GET /search/history (after delete)' });
      t.check(!itemsOf(after.body).some((e) => e.id === entry.id), 'still listed after delete');
      await t.call('buyer', 'POST', '/search/history', { body: { query: '' }, expect: 400, label: 'record an empty search' });
    },
  },
  {
    id: 'DSC-07',
    area: AREA,
    title: "Saved searches: save the map area, rename, turn alerts off, delete; others can't touch it",
    needs: ['sessions'],
    run: async (t) => {
      const body = { ...QA_AREA, name: `${QA_MARK} houses`, propertyType: 'House', listingTypes: ['Sale'], minPrice: 1000, alerts: true };
      const created = await t.call('buyer', 'POST', '/search/saved', { body, expect: 201 });
      const id = created.body.id;
      t.check(id, 'no id');
      const list = await t.call('buyer', 'GET', '/search/saved', { expect: 200 });
      t.check(itemsOf(list.body).some((s) => s.id === id), 'not in the saved list');
      const renamed = await t.call('buyer', 'PATCH', '/search/saved/:id', { params: { id }, body: { name: `${QA_MARK} renamed`, alerts: false }, expect: 200 });
      t.check(renamed.body.alerts === false && renamed.body.name === `${QA_MARK} renamed`, `update not saved ${JSON.stringify(renamed.body).slice(0, 150)}`);
      await t.call('outsider', 'PATCH', '/search/saved/:id', { params: { id }, body: { alerts: true }, expect: 404, label: "edit someone else's" });
      // Deleting is scoped to the caller: someone else's id is quietly left alone.
      await t.call('outsider', 'DELETE', '/search/saved/:id', { params: { id }, expect: [204, 404], label: "delete someone else's" });
      const kept = await t.call('buyer', 'GET', '/search/saved', { expect: 200, label: 'GET /search/saved (after a stranger tried to delete)' });
      t.check(itemsOf(kept.body).some((s) => s.id === id), "a stranger deleted the buyer's saved search");
      await t.call('buyer', 'POST', '/search/saved', { body: { ...body, name: '' }, expect: 400, label: 'save with no name' });
      await t.call('buyer', 'POST', '/search/saved', { body: { ...body, propertyType: 'Castle' }, expect: 400, label: 'save with unknown type' });
      await t.call('buyer', 'DELETE', '/search/saved/:id', { params: { id }, expect: [200, 204] });
      const after = await t.call('buyer', 'GET', '/search/saved', { expect: 200, label: 'GET /search/saved (after delete)' });
      t.check(!itemsOf(after.body).some((s) => s.id === id), 'still listed after delete');
    },
  },
];
