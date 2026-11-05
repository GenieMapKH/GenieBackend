'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { QA_MARK, QA_SPOT, QA_AREA } = require('../lib/config');
const { fieldsPresent, itemsOf } = require('../lib/json-search');

const AREA = 'Listings';
const TINY_JPEG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tiny.jpg'));
const OWNER_CONTACT_FIELDS = ['phone', 'email', 'contactPhone'];

const listing = (t) => ({ params: { id: t.state.listingId } });
const onMap = (body, id) => itemsOf(body).some((p) => p.id === id);

module.exports = [
  {
    id: 'LST-07',
    area: AREA,
    title: 'Seller uploads a photo: upload link, storage upload, confirm, thumbnail',
    needs: ['listingId'],
    run: async (t) => {
      const slots = await t.call('seller', 'POST', '/properties/:id/images/presigned-url', { ...listing(t), body: { fileNames: ['qa.jpg'] }, expect: 201 });
      const [slot] = itemsOf(slots.body);
      t.check(slot?.fileName && slot?.signedUrl, `no upload slot: ${JSON.stringify(slots.body).slice(0, 200)}`);
      const upload = await t.api.upload(slot.signedUrl, TINY_JPEG, 'image/jpeg');
      t.record('upload photo to storage', 'seller', upload.status, null);
      t.check(upload.status === 200, `storage upload gave ${upload.status}`);

      const confirmed = await t.call('seller', 'POST', '/properties/:id/images/confirm', { ...listing(t), body: { fileNames: [slot.fileName] }, expect: [200, 201] });
      const images = confirmed.body.images ?? [];
      t.check(images.length === 1, `${images.length} images after confirming one`);
      t.state.imageUrl = images[0].url;
      t.soft(Boolean(images[0].thumbnailUrl), `no thumbnail made: ${JSON.stringify(images[0])}`);
      const photo = await fetch(images[0].url);
      t.record('download photo', 'guest', photo.status, null);
      t.check(photo.ok, `photo URL answers ${photo.status}`);

      await t.call('seller', 'POST', '/properties/:id/images/confirm', {
        ...listing(t),
        body: { fileNames: ['someone-else/other-listing/x.jpg'] },
        expect: 400,
        label: "confirm someone else's file",
      });
    },
  },
  {
    id: 'LST-08',
    area: AREA,
    title: 'Seller publishes the draft (free publish); publishing twice is refused',
    needs: ['listingId'],
    run: async (t) => {
      const published = await t.call('seller', 'PATCH', '/properties/:id/publish', { ...listing(t), expect: 200 });
      t.check(published.body.status === 'Active', `status ${published.body.status}`);
      t.check(Boolean(published.body.publishedAt), 'publishedAt not set');
      await t.call('seller', 'PATCH', '/properties/:id/publish', { ...listing(t), expect: 400, label: 'publish again' });
      t.state.published = true;
    },
  },
  {
    id: 'LST-09',
    area: AREA,
    title: 'Published listing is on the map, in "closest", and its detail page hides owner contact from guests',
    needs: ['published'],
    run: async (t) => {
      const asGuest = await t.call(null, 'GET', '/public/properties/:id', { ...listing(t), expect: 200, label: 'detail as guest' });
      const leaked = fieldsPresent(asGuest.body, OWNER_CONTACT_FIELDS);
      t.check(leaked.length === 0, `guest sees owner contact: ${leaked.join(', ')}`);
      const asBuyer = await t.call('buyer', 'GET', '/public/properties/:id', { ...listing(t), expect: 200, label: 'detail as signed-in buyer' });
      t.soft(asBuyer.body.contactPhone === '+12025550171', `signed-in buyer sees contactPhone ${asBuyer.body.contactPhone}`);

      const map = await t.call(null, 'GET', '/public/properties/map', { query: QA_AREA, expect: 200 });
      t.check(onMap(map.body, t.state.listingId), 'not on the public map');
      const filtered = await t.call(null, 'GET', '/public/properties/map', {
        query: { ...QA_AREA, listingType: ['Rent', 'To Let'] },
        expect: 200,
        label: 'map filtered to rentals',
      });
      t.check(!onMap(filtered.body, t.state.listingId), 'a sale listing passed the rental filter');
      const priced = await t.call(null, 'GET', '/public/properties/map', {
        query: { ...QA_AREA, minPrice: 200000, maxPrice: 300000 },
        expect: 200,
        label: 'map filtered by price',
      });
      t.check(onMap(priced.body, t.state.listingId), 'missing from a price range that includes it');

      const closest = await t.call(null, 'GET', '/public/properties/closest', { query: QA_SPOT, expect: 200 });
      t.check(itemsOf(closest.body)[0]?.id === t.state.listingId, 'not the closest listing to its own pin');
      await t.call(null, 'GET', '/public/properties/map/prices', { query: { ...QA_AREA, upTo: 1000000 }, expect: 200 });
      const mine = await t.call('seller', 'GET', '/properties/my/in-area', { query: QA_AREA, expect: 200 });
      t.check(onMap(mine.body, t.state.listingId), 'missing from the seller\'s own map');
    },
  },
  {
    id: 'LST-13',
    area: AREA,
    title: 'Nearby places on the detail page; directions to a place that does not exist are refused',
    needs: ['published'],
    run: async (t) => {
      // The QA spot is mid-ocean, so there are no markets near it: only the refusals can be checked.
      const detail = await t.call(null, 'GET', '/public/properties/:id', { ...listing(t), expect: 200 });
      t.check(Array.isArray(detail.body.nearbyPlaces), `nearbyPlaces is ${typeof detail.body.nearbyPlaces}`);
      const route = '/public/properties/:id/nearby/:category/:rank/route';
      await t.call(null, 'GET', route, { params: { id: t.state.listingId, category: 'market', rank: 1 }, expect: 404, label: 'route to a market that is not there' });
      await t.call(null, 'GET', route, { params: { id: t.state.listingId, category: 'casino', rank: 1 }, expect: 400, label: 'route: unknown category' });
      await t.call(null, 'GET', route, { params: { id: t.state.listingId, category: 'school', rank: 'first' }, expect: 400, label: 'route: rank not a number' });
    },
  },
  {
    id: 'LST-10',
    area: AREA,
    title: 'Unpublish takes it off the map; publishing again puts it back',
    needs: ['published'],
    run: async (t) => {
      const hidden = await t.call('seller', 'PATCH', '/properties/:id/unpublish', { ...listing(t), expect: 200 });
      t.check(hidden.body.status === 'Draft', `status after unpublish ${hidden.body.status}`);
      await t.call(null, 'GET', '/public/properties/:id', { ...listing(t), expect: 404, label: 'detail as guest (unpublished)' });
      const map = await t.call(null, 'GET', '/public/properties/map', { query: QA_AREA, expect: 200, label: 'map (unpublished)' });
      t.check(!onMap(map.body, t.state.listingId), 'still on the map after unpublishing');
      const again = await t.call('seller', 'PATCH', '/properties/:id/publish', { ...listing(t), expect: 200, label: 'publish again' });
      t.check(again.body.status === 'Active', `status ${again.body.status}`);
    },
  },
  {
    id: 'LST-11',
    area: AREA,
    title: 'Mark as sold, then relist',
    needs: ['published'],
    run: async (t) => {
      const sold = await t.call('seller', 'PATCH', '/properties/:id/mark-sold', { ...listing(t), expect: 200 });
      t.check(sold.body.status === 'Sold', `status ${sold.body.status}`);
      await t.call('seller', 'PATCH', '/properties/:id/mark-sold', { ...listing(t), expect: 400, label: 'mark sold again' });
      await t.call('buyer', 'PATCH', '/properties/:id/relist', { ...listing(t), expect: 404, label: 'relist as buyer' });
      const relisted = await t.call('seller', 'PATCH', '/properties/:id/relist', { ...listing(t), expect: 200 });
      t.check(relisted.body.status === 'Active', `status ${relisted.body.status}`);
      await t.call('seller', 'PATCH', '/properties/:id/relist', { ...listing(t), expect: 400, label: 'relist an active listing' });
    },
  },
  {
    id: 'LST-12',
    area: AREA,
    title: 'App flow: a listing created as Active goes on the map once its boundary is drawn',
    needs: ['sessions'],
    run: async (t) => {
      const created = await t.call('seller', 'POST', '/properties', {
        body: { title: `${QA_MARK} Land for rent`, price: 900, propertyType: 'Land', listingType: 'Rent', landSize: 500, status: 'Active' },
        expect: 201,
      });
      const id = created.body.id;
      t.state.secondListingId = id;
      t.check(created.body.status === 'Active', `status ${created.body.status}`);
      await t.call('seller', 'PATCH', '/properties/:id/boundary', {
        params: { id },
        body: { boundaryPoints: [{ lat: QA_SPOT.lat + 0.01, lng: QA_SPOT.lng }, { lat: QA_SPOT.lat + 0.011, lng: QA_SPOT.lng }, { lat: QA_SPOT.lat + 0.011, lng: QA_SPOT.lng + 0.001 }] },
        expect: 200,
      });
      const map = await t.call(null, 'GET', '/public/properties/map', { query: { ...QA_AREA, listingType: 'Rent' }, expect: 200 });
      t.check(onMap(map.body, id), 'Active listing with a boundary is not on the map');

      const removed = await t.call('seller', 'DELETE', '/properties/:id', { params: { id }, expect: 200 });
      t.check(removed.body.status === 'Deleted', `status after delete ${removed.body.status}`);
      await t.call(null, 'GET', '/public/properties/:id', { params: { id }, expect: 404, label: 'detail as guest (deleted)' });
      const after = await t.call(null, 'GET', '/public/properties/map', { query: { ...QA_AREA, listingType: 'Rent' }, expect: 200, label: 'map (deleted)' });
      t.check(!onMap(after.body, id), 'deleted listing still on the map');
      t.state.secondListingId = null;
    },
  },
];
