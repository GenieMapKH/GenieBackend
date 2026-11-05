'use strict';
const { randomUUID } = require('node:crypto');

const AREA = 'Payments';

module.exports = [
  {
    id: 'PAY-01',
    area: AREA,
    title: "Checkout refuses guests, bad input and someone else's listing (no payment is started)",
    needs: ['published'],
    run: async (t) => {
      // Every request here is refused before a transaction row is written.
      await t.call(null, 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId }, expect: 401, label: 'checkout as guest' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: 'nope' }, expect: 400, label: 'checkout: not a uuid' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId, method: 'BITCOIN' }, expect: 400, label: 'checkout: unknown method' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId }, expect: [403, 404], label: "checkout someone else's listing" });
      await t.call('seller', 'POST', '/payments/checkout', { body: { propertyId: randomUUID() }, expect: 404, label: 'checkout an unknown listing' });
      await t.call('seller', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId }, expect: 400, label: 'checkout an already live listing' });
    },
  },
  {
    id: 'PAY-02',
    area: AREA,
    title: 'Payment webhook refuses unsigned callbacks',
    run: async (t) => {
      await t.call(null, 'POST', '/payments/webhook', { body: { transactionId: randomUUID(), status: 'SUCCESS' }, expect: [401, 403] });
      await t.call(null, 'POST', '/payments/webhook', {
        body: { transactionId: randomUUID(), status: 'SUCCESS' },
        headers: { 'x-webhook-secret': 'forged' },
        expect: [401, 403],
        label: 'webhook with a forged secret',
      });
    },
  },
  {
    id: 'PAY-03',
    area: AREA,
    title: 'Routes the app already calls but the backend does not have yet',
    known: 'subscription checkout and transaction status are app-only so far',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('seller', 'POST', '/payments/subscriptions/checkout', { body: { plan: 'basic' }, expect: 404 });
      await t.call('seller', 'GET', '/payments/transactions/:id', { params: { id: randomUUID() }, expect: 404 });
    },
  },
];
