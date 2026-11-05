'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { sealedText } = require('../lib/chat-fixtures');
const { itemsOf } = require('../lib/json-search');

const AREA = 'Chat';

const messagesOf = (body) => (Array.isArray(body?.messages) ? body.messages : itemsOf(body));
const mentions = (item, id) => JSON.stringify(item).includes(id);

/** Sends over the socket as `from`, records the ack, and answers it. */
async function send(t, from, payload, label) {
  const ack = await t.state.sockets[from].emitAck('sendMessage', payload);
  t.record(label, from, ack?.status ?? 'no ack', ack);
  return ack;
}

module.exports = [
  {
    id: 'CHT-04',
    area: AREA,
    title: 'Seller sends a message; buyer gets it live; a resend with the same id is not duplicated',
    needs: ['sockets'],
    run: async (t) => {
      const id = randomUUID();
      const payload = { id, recipientId: t.userId('buyer'), ...sealedText() };
      const ack = await send(t, 'seller', payload, 'sendMessage seller -> buyer');
      t.check(ack.status === 'ok' && ack.messageId === id, `ack ${JSON.stringify(ack)}`);
      const live = await t.state.sockets.buyer.waitFor('newMessage', (m) => m.id === id);
      t.record('buyer receives newMessage', 'buyer', live ? 'received' : 'missed', live);
      t.check(live, 'buyer did not receive the message live');
      t.check(live.ciphertext === payload.ciphertext, 'ciphertext changed in transit');

      const again = await send(t, 'seller', payload, 'resend the same message id');
      t.check(again.status === 'ok' && again.messageId === id, `resend ack ${JSON.stringify(again)}`);
      const history = await t.call('buyer', 'GET', '/chat/messages/:id', { params: { id: t.userId('seller') }, expect: 200 });
      const copies = messagesOf(history.body).filter((m) => m.id === id).length;
      t.check(copies === 1, `${copies} copies of the message in history`);
      t.state.firstMessageId = id;
    },
  },
  {
    id: 'CHT-05',
    area: AREA,
    title: 'Conversation list, history paging and marking as read',
    needs: ['firstMessageId'],
    run: async (t) => {
      const list = await t.call('buyer', 'GET', '/chat/conversations', { expect: 200 });
      t.check(itemsOf(list.body).some((c) => mentions(c, t.userId('seller'))), 'seller conversation not in the list');
      await t.call('buyer', 'GET', '/chat/conversations', { query: { limit: 5 }, expect: 200, label: 'conversations (page of 5)' });
      await t.call('buyer', 'GET', '/chat/conversations', { query: { list: 'bogus' }, expect: 400, label: 'conversations (unknown list)' });
      await t.call('buyer', 'GET', '/chat/messages/:id', { params: { id: t.userId('seller') }, query: { limit: 1 }, expect: 200, label: 'history (page of 1)' });
      await t.call('buyer', 'GET', '/chat/messages/:id', { params: { id: t.userId('seller') }, query: { limit: 1000 }, expect: 400, label: 'history (page too big)' });
      await t.call('buyer', 'POST', '/chat/messages/:id/read', { params: { id: t.userId('seller') }, expect: [200, 201] });
    },
  },
  {
    id: 'CHT-06',
    area: AREA,
    title: 'Reply, edit (own message only) and delete for everyone, seen live by the other side',
    needs: ['firstMessageId'],
    run: async (t) => {
      const replyId = randomUUID();
      const reply = await send(t, 'buyer', { id: replyId, recipientId: t.userId('seller'), replyToId: t.state.firstMessageId, ...sealedText() }, 'buyer replies');
      t.check(reply.status === 'ok', `reply ack ${JSON.stringify(reply)}`);
      const got = await t.state.sockets.seller.waitFor('newMessage', (m) => m.id === replyId);
      t.check(got && JSON.stringify(got).includes(t.state.firstMessageId), 'reply arrived without what it replies to');

      const edit = sealedText();
      await t.call('seller', 'POST', '/chat/messages/:id/edit', { params: { id: t.state.firstMessageId }, body: edit, expect: [200, 201] });
      const edited = await t.state.sockets.buyer.waitFor('messageEdited', (m) => mentions(m, t.state.firstMessageId));
      t.record('buyer receives messageEdited', 'buyer', edited ? 'received' : 'missed', edited);
      t.check(edited, 'edit not pushed live');
      await t.call('buyer', 'POST', '/chat/messages/:id/edit', { params: { id: t.state.firstMessageId }, body: sealedText(), expect: [403, 404], label: "edit someone else's message" });

      await t.call('buyer', 'POST', '/chat/messages/:id/delete', { params: { id: replyId }, body: { forEveryone: true }, expect: [200, 201] });
      const deleted = await t.state.sockets.seller.waitFor('messageDeleted', (m) => mentions(m, replyId));
      t.record('seller receives messageDeleted', 'seller', deleted ? 'received' : 'missed', deleted);
      t.check(deleted, 'delete not pushed live');
      const history = await t.call('seller', 'GET', '/chat/messages/:id', { params: { id: t.userId('buyer') }, expect: 200, label: 'history after delete' });
      t.check(!messagesOf(history.body).some((m) => m.id === replyId), 'deleted message still in history');
    },
  },
  {
    id: 'CHT-07',
    area: AREA,
    title: 'Sending is refused: to yourself, malformed, unknown recipient, and to someone who blocked you',
    needs: ['sockets'],
    run: async (t) => {
      const self = await send(t, 'seller', { recipientId: t.userId('seller'), ...sealedText() }, 'send to yourself');
      t.check(self.status === 'error', `self-send ack ${JSON.stringify(self)}`);
      const bad = await send(t, 'seller', { recipientId: 'nope' }, 'malformed message');
      t.check(bad.status === 'error', `malformed ack ${JSON.stringify(bad)}`);
      const nobody = await send(t, 'seller', { recipientId: randomUUID(), ...sealedText() }, 'unknown recipient');
      t.check(nobody.status === 'error', `unknown recipient ack ${JSON.stringify(nobody)}`);

      await t.call('outsider', 'PUT', '/users/:id/block', { params: { id: t.userId('seller') }, expect: 200, label: 'outsider blocks seller' });
      const blocked = await send(t, 'seller', { recipientId: t.userId('outsider'), ...sealedText() }, 'send to someone who blocked you');
      await t.call('outsider', 'DELETE', '/users/:id/block', { params: { id: t.userId('seller') }, expect: 200, label: 'outsider unblocks seller' });
      t.check(blocked.status === 'error' && blocked.code === 'blocked', `blocked ack ${JSON.stringify(blocked)}`);
    },
  },
  {
    id: 'CHT-08',
    area: AREA,
    title: 'Photo attachment: upload link, storage upload, download link for the two people only, removal',
    needs: ['sockets'],
    run: async (t) => {
      const slot = await t.call('seller', 'POST', '/chat/attachments', { body: { recipientId: t.userId('buyer') }, expect: 201 });
      t.check(slot.body.path && slot.body.uploadUrl, `slot ${JSON.stringify(slot.body).slice(0, 150)}`);
      const upload = await t.api.upload(slot.body.uploadUrl, randomBytes(512), 'application/octet-stream');
      t.record('upload attachment to storage', 'seller', upload.status, null);
      t.check(upload.status === 200, `storage upload gave ${upload.status} ${JSON.stringify(upload.body)}`);

      const [senderId, recipientId, fileId] = slot.body.path.split('/');
      const params = { senderId, recipientId, fileId };
      const route = '/chat/attachments/:senderId/:recipientId/:fileId';
      const link = await t.call('buyer', 'GET', route, { params, expect: 200, label: 'download link as recipient' });
      const url = link.body.url ?? link.body.downloadUrl ?? link.body.signedUrl;
      t.check(url, `no link: ${JSON.stringify(link.body)}`);
      const file = await fetch(url);
      t.record('download attachment', 'buyer', file.status, null);
      t.check(file.ok, `download gave ${file.status}`);
      await t.call('outsider', 'GET', route, { params, expect: [403, 404], label: 'download link as a stranger' });

      const id = randomUUID();
      await send(t, 'seller', { id, recipientId: t.userId('buyer'), ...sealedText() }, 'send the attachment message');
      await t.call('seller', 'POST', '/chat/messages/:id/delete', { params: { id }, body: { forEveryone: true, attachmentPath: slot.body.path }, expect: [200, 201], label: 'delete message and its file' });
      const gone = await t.call('buyer', 'GET', route, { params, label: 'download link after removal' });
      if (gone.status === 200) {
        const stale = await fetch(gone.body.url ?? gone.body.downloadUrl ?? gone.body.signedUrl);
        t.check(!stale.ok, 'attachment file still downloadable after removal');
      }
    },
  },
  {
    id: 'CHT-09',
    area: AREA,
    title: 'Archive and unarchive a conversation',
    needs: ['firstMessageId'],
    run: async (t) => {
      const partner = { params: { id: t.userId('seller') } };
      await t.call('buyer', 'POST', '/chat/conversations/:id/archive', { ...partner, expect: [200, 201] });
      const archived = await t.call('buyer', 'GET', '/chat/conversations', { query: { list: 'archived' }, expect: 200, label: 'archived list' });
      t.check(itemsOf(archived.body).some((c) => mentions(c, t.userId('seller'))), 'not in the archive');
      const main = await t.call('buyer', 'GET', '/chat/conversations', { expect: 200, label: 'main list while archived' });
      t.check(!itemsOf(main.body).some((c) => mentions(c, t.userId('seller'))), 'archived conversation still in the main list');
      await t.call('buyer', 'POST', '/chat/conversations/:id/unarchive', { ...partner, expect: [200, 201] });
      const back = await t.call('buyer', 'GET', '/chat/conversations', { expect: 200, label: 'main list after unarchive' });
      t.check(itemsOf(back.body).some((c) => mentions(c, t.userId('seller'))), 'not back in the main list');
    },
  },
  {
    id: 'CHT-12',
    area: AREA,
    title: 'Delete a chat for me only: gone for the buyer, still there for the seller',
    needs: ['firstMessageId'],
    run: async (t) => {
      await t.call('buyer', 'POST', '/chat/conversations/:id/delete', { params: { id: t.userId('seller') }, body: {}, expect: [200, 201] });
      const mine = await t.call('buyer', 'GET', '/chat/messages/:id', { params: { id: t.userId('seller') }, expect: 200, label: "buyer's history" });
      t.check(messagesOf(mine.body).length === 0, `buyer still sees ${messagesOf(mine.body).length} messages`);
      const theirs = await t.call('seller', 'GET', '/chat/messages/:id', { params: { id: t.userId('buyer') }, expect: 200, label: "seller's history" });
      t.check(messagesOf(theirs.body).some((m) => m.id === t.state.firstMessageId), 'deleting for me removed it for the seller too');
    },
  },
  {
    id: 'CHT-10',
    area: AREA,
    title: 'Online status: buyer watches the seller and sees them online',
    needs: ['sockets'],
    run: async (t) => {
      const watch = await t.state.sockets.buyer.emitAck('watchPresence', { userId: t.userId('seller') });
      t.record('watchPresence', 'buyer', watch?.status ?? 'no ack', watch);
      t.check(watch.status === 'ok' && watch.presence?.online === true, `presence ${JSON.stringify(watch)}`);
      const bad = await t.state.sockets.buyer.emitAck('watchPresence', { userId: 'nope' });
      t.record('watchPresence (bad id)', 'buyer', bad?.status ?? 'no ack', bad);
      t.check(bad.status === 'error', `bad id ${JSON.stringify(bad)}`);
      const stop = await t.state.sockets.buyer.emitAck('unwatchPresence', { userId: t.userId('seller') });
      t.record('unwatchPresence', 'buyer', stop?.status ?? 'no ack', stop);
    },
  },
];
