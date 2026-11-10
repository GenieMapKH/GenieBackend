'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { managedText } = require('./chat-fixtures');

test('managed QA messages preserve identities and reply metadata', () => {
  const body = managedText({ id: 'message', senderId: 'alice', recipientId: 'bob', text: 'hello', replyToId: 'earlier' });
  assert.equal(body.nonce, 'managed-v1');
  assert.deepEqual(JSON.parse(Buffer.from(body.ciphertext, 'base64').toString()), {
    v: 1, id: 'message', from: 'alice', to: 'bob', text: 'hello', re: 'earlier',
  });
});
