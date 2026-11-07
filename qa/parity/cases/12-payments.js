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
      await t.call(null, 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId, requestId: randomUUID() }, expect: 401, label: 'checkout as guest' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: 'nope', requestId: randomUUID() }, expect: 400, label: 'checkout: not a uuid' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId, method: 'BITCOIN', requestId: randomUUID() }, expect: 400, label: 'checkout: unknown method' });
      await t.call('buyer', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId, requestId: randomUUID() }, expect: [403, 404, 501], label: "checkout someone else's listing (or payments disabled)" });
      await t.call('seller', 'POST', '/payments/checkout', { body: { propertyId: randomUUID(), requestId: randomUUID() }, expect: [404, 501], label: 'checkout an unknown listing (or payments disabled)' });
      await t.call('seller', 'POST', '/payments/checkout', { body: { propertyId: t.state.listingId, requestId: randomUUID() }, expect: [400, 501], label: 'checkout an already live listing (or payments disabled)' });
    },
  },
  {
    id: 'PAY-02',
    area: AREA,
    title: 'Payment webhook refuses unsigned callbacks',
    run: async (t) => {
      await t.call(null, 'POST', '/payments/webhook', { body: { transactionId: randomUUID(), status: 'SUCCESS' }, expect: [401, 403, 501] });
      await t.call(null, 'POST', '/payments/webhook', {
        body: { transactionId: randomUUID(), status: 'SUCCESS' },
        headers: { 'x-webhook-secret': 'forged' },
        expect: [401, 403, 501],
        label: 'webhook with a forged secret',
      });
    },
  },
  {
    id: 'PAY-03',
    area: AREA,
    title: 'Subscription routes reject invalid purchases and unknown transactions',
    needs: ['sessions'],
    run: async (t) => {
      await t.call('seller', 'POST', '/payments/subscriptions/checkout', { body: { tier: 'basic', method: 'aba_pay', requestId: randomUUID() }, expect: 400 });
      await t.call('seller', 'GET', '/payments/subscriptions/current', { expect: 200 });
      await t.call('seller', 'GET', '/payments/transactions/:id', { params: { id: randomUUID() }, expect: 404 });
    },
  },
];
