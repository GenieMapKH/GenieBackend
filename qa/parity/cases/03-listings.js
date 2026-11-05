'use strict';
const { randomUUID } = require('node:crypto');
const { QA_MARK, QA_SPOT } = require('../lib/config');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Listings';

const NEW_LISTING = {
  title: `${QA_MARK} House for sale`,
  description: 'Automated test listing. It is removed again within a few minutes.',
  price: 250000,
  propertyType: 'House',
  listingType: 'Sale',
  titleType: 'Hard Title',
  status: 'Draft',
  bedrooms: 3,
  bathrooms: 2,
  landSize: 120,
  buildingSize: 200,
  floors: 2,
  hasParking: true,
  furnishing: 'Unfurnished',
  contactPhone: '+12025550171',
  keywords: ['road_access'],
};

/** A small square around the QA spot, as a drawn plot. */
const BOUNDARY = [
  { lat: QA_SPOT.lat + 0.0002, lng: QA_SPOT.lng - 0.0002 },
  { lat: QA_SPOT.lat + 0.0002, lng: QA_SPOT.lng + 0.0002 },
  { lat: QA_SPOT.lat - 0.0002, lng: QA_SPOT.lng + 0.0002 },
  { lat: QA_SPOT.lat - 0.0002, lng: QA_SPOT.lng - 0.0002 },
];

const listing = (t) => ({ params: { id: t.state.listingId } });

module.exports = [
  {
    id: 'LST-01',
    area: AREA,
    title: 'Seller saves a new listing as a draft, with house details',
    needs: ['sessions'],
    run: async (t) => {
      const created = await t.call('seller', 'POST', '/properties', { body: NEW_LISTING, expect: 201 });
      t.state.listingId = created.body.id;
      t.check(created.body.status === 'Draft', `status ${created.body.status}`);
      t.check(Number(created.body.price) === NEW_LISTING.price, `price ${created.body.price}`);
      for (const key of ['bedrooms', 'bathrooms', 'titleType', 'furnishing', 'hasParking']) {
        t.soft(created.body[key] === NEW_LISTING[key], `${key} saved as ${created.body[key]}`);
      }
      t.soft(created.body.userId === t.userId('seller'), 'listing not owned by the seller');
    },
  },
  {
    id: 'LST-02',
    area: AREA,
    title: 'Listings with bad values are refused',
    needs: ['sessions'],
    run: async (t) => {
      const bad = [
        ['no title', { ...NEW_LISTING, title: undefined }],
        ['negative price', { ...NEW_LISTING, price: -1 }],
        ['unknown property type', { ...NEW_LISTING, propertyType: 'Castle' }],
        ['unknown listing type', { ...NEW_LISTING, listingType: 'Swap' }],
        ['discount over 100%', { ...NEW_LISTING, discountType: 'percent', discountValue: 150 }],
        ['discount above the price', { ...NEW_LISTING, discountType: 'amount', discountValue: 300000 }],
        ['unknown keyword', { ...NEW_LISTING, keywords: ['castle_moat'] }],
        ['created as Sold', { ...NEW_LISTING, status: 'Sold' }],
      ];
      for (const [label, body] of bad) {
        await t.call('seller', 'POST', '/properties', { body, expect: 400, label: `POST /properties: ${label}` });
      }
    },
  },
  {
    id: 'LST-03',
    area: AREA,
    title: 'Seller finds the draft in My Properties (all, and the Draft tab with counts)',
    needs: ['listingId'],
    run: async (t) => {
      await t.call('seller', 'GET', '/properties/:id', { ...listing(t), expect: 200 });
      const all = await t.call('seller', 'GET', '/properties', { expect: 200, label: 'GET /properties (all)' });
      t.check(itemsOf(all.body).some((p) => p.id === t.state.listingId), 'draft missing from the full list');
      const drafts = await t.call('seller', 'GET', '/properties', { query: { limit: 20, status: 'Draft,Expired' }, expect: 200, label: 'GET /properties (Draft tab)' });
      t.check(itemsOf(drafts.body).some((p) => p.id === t.state.listingId), 'draft missing from the Draft tab');
      t.check((drafts.body.countByStatus?.Draft ?? 0) >= 1, `countByStatus ${JSON.stringify(drafts.body.countByStatus)}`);
      const active = await t.call('seller', 'GET', '/properties', { query: { limit: 20, status: 'Active' }, expect: 200, label: 'GET /properties (Active tab)' });
      t.check(!itemsOf(active.body).some((p) => p.id === t.state.listingId), 'draft shown in the Active tab');
      await t.call('seller', 'GET', '/properties', { query: { limit: 20, status: 'Bogus' }, expect: 400, label: 'GET /properties (unknown status)' });
    },
  },
  {
    id: 'LST-04',
    area: AREA,
    title: "A draft is private: others can't see, edit, publish or delete it",
    needs: ['listingId'],
    run: async (t) => {
      await t.call('buyer', 'GET', '/properties/:id', { ...listing(t), expect: 404 });
      await t.call(null, 'GET', '/public/properties/:id', { ...listing(t), expect: 404 });
      await t.call('buyer', 'GET', '/public/properties/:id', { ...listing(t), expect: 404 });
      await t.call('buyer', 'PATCH', '/properties/:id', { ...listing(t), body: { price: 1 }, expect: 404 });
      await t.call('buyer', 'PATCH', '/properties/:id/publish', { ...listing(t), expect: 404 });
      await t.call('buyer', 'PATCH', '/properties/:id/pin', { ...listing(t), body: QA_SPOT, expect: 404 });
      await t.call('buyer', 'POST', '/properties/:id/images/presigned-url', { ...listing(t), body: { fileNames: ['x.jpg'] }, expect: 404 });
      await t.call('buyer', 'DELETE', '/properties/:id', { ...listing(t), expect: 404 });
      await t.call('seller', 'GET', '/properties/:id', { params: { id: randomUUID() }, expect: 404, label: 'GET /properties/:id (unknown)' });
      await t.call('seller', 'GET', '/properties/:id', { params: { id: 'nope' }, expect: 400, label: 'GET /properties/:id (not a uuid)' });
    },
  },
  {
    id: 'LST-05',
    area: AREA,
    title: 'Seller edits price, description and keywords',
    needs: ['listingId'],
    run: async (t) => {
      const body = { price: 240000, description: `${NEW_LISTING.description} Edited.`, keywords: ['road_access', 'near_market'] };
      const edited = await t.call('seller', 'PATCH', '/properties/:id', { ...listing(t), body, expect: 200 });
      t.check(Number(edited.body.price) === 240000, `price ${edited.body.price}`);
      t.check(edited.body.description === body.description, 'description not saved');
      const keywords = (edited.body.keywords ?? []).map((k) => k.keyword ?? k).sort();
      t.check(JSON.stringify(keywords) === JSON.stringify([...body.keywords].sort()), `keywords ${JSON.stringify(keywords)}`);
      await t.call('seller', 'PATCH', '/properties/:id', { ...listing(t), body: { price: -5 }, expect: 400, label: 'PATCH /properties/:id (negative price)' });
    },
  },
  {
    id: 'LST-06',
    area: AREA,
    title: 'Seller places the pin and draws the land boundary',
    needs: ['listingId'],
    run: async (t) => {
      const pinned = await t.call('seller', 'PATCH', '/properties/:id/pin', { ...listing(t), body: QA_SPOT, expect: 200 });
      t.check(pinned.body.lat === QA_SPOT.lat && pinned.body.lng === QA_SPOT.lng, `pin saved as ${pinned.body.lat},${pinned.body.lng}`);
      const drawn = await t.call('seller', 'PATCH', '/properties/:id/boundary', { ...listing(t), body: { boundaryPoints: BOUNDARY }, expect: 200 });
      t.check(Array.isArray(drawn.body.boundaryPoints) && drawn.body.boundaryPoints.length === BOUNDARY.length, 'boundary not saved');
      await t.call('seller', 'PATCH', '/properties/:id/pin', { ...listing(t), body: { lat: 100, lng: 0 }, expect: 400, label: 'PATCH pin (latitude 100)' });
      await t.call('seller', 'PATCH', '/properties/:id/boundary', { ...listing(t), body: { boundaryPoints: [{ lat: 'x' }] }, expect: 400, label: 'PATCH boundary (bad point)' });
    },
  },
];
