'use strict';

/** The app's managed transport envelope. The server encrypts it before storage. */
function managedText({ id, senderId, recipientId, text = 'QA message', replyToId }) {
  return {
    ciphertext: Buffer.from(JSON.stringify({
      v: 1, id, from: senderId, to: recipientId, text,
      ...(replyToId && { re: replyToId }),
    })).toString('base64'),
    nonce: 'managed-v1',
  };
}

module.exports = { managedText };
