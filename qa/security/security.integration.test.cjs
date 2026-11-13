const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { PrismaService, UploadBudgets } = require('../../shared/dist');
const { RefreshTokenRepository } = require('../../authentication/dist/auth/sessions/refresh-token.repository');
const { TokenIssuerService } = require('../../authentication/dist/auth/sessions/token-issuer.service');
const { SessionRevocationService } = require('../../authentication/dist/auth/sessions/session-revocation.service');
const { SessionService } = require('../../authentication/dist/auth/sessions/session.service');
const { RevokedSessionStore } = require('../../authentication/dist/auth/sessions/revoked-session.store');
const { UserRepository } = require('../../authentication/dist/auth/users/user.repository');
const { PropertyUploadReservations } = require('../../property/dist/properties/services/property-upload-reservations');

assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/security_remediation_20261113_test');
const prisma = new PrismaService();
const repository = new RefreshTokenRepository(prisma);
const users = new UserRepository(prisma);
const ended = [];
const revocations = new SessionRevocationService(repository, { add: async (ids) => ended.push(...ids) });
const signer = {
  sign: (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${randomUUID()}`,
  verifyRefreshToken: (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()),
};
const issuer = new TokenIssuerService(signer, repository, {});
const client = { deviceName: 'Security fixture', platform: 'test', ipAddress: null };
function latch() { let release; const wait = new Promise((resolve) => { release = resolve; }); return { wait, release }; }
function sessions(customIssuer = issuer) { return new SessionService(signer, repository, customIssuer, users, revocations, { require: async () => {} }); }
async function account() { return prisma.user.create({ data: { passwordHash: 'fixture-password-hash', hasPassword: true } }); }
before(async () => prisma.$connect());
after(async () => prisma.$disconnect());

for (const action of ['logout-all', 'device-revoke', 'password-reset']) {
  test(`F09 PostgreSQL: ${action} serializes with consume-and-insert and wins permanently`, async () => {
    const user = await account();
    const initial = await issuer.issue(user.id, 'user', client);
    const entered = latch(), resume = latch();
    const refresh = sessions({ issue: async (...args) => { entered.release(); await resume.wait; return issuer.issue(...args); } }).refresh(initial.refreshToken, client);
    await entered.wait;
    let completed = false;
    const termination = (async () => {
      if (action === 'password-reset') await users.update(user.id, { password_hash: 'new-fixture-password', has_password: true });
      if (action === 'device-revoke') await revocations.endSession(user.id, initial.sessionId);
      else await revocations.endAllSessions(user.id);
      completed = true;
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(completed, false, 'Termination must not report success while replacement insertion is pending');
    resume.release();
    await refresh; await termination;
    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id, revoked: false } }), 0);
    assert.ok(ended.includes(initial.sessionId));
    await assert.rejects(sessions().refresh(initial.refreshToken, client));
  });
}

test('F09: logging out with an older rotated token terminates its entire device, not another device', async () => {
  const user = await account();
  const first = await issuer.issue(user.id, 'user', client);
  const other = await issuer.issue(user.id, 'user', client);
  const rotated = await sessions().refresh(first.refreshToken, client);
  await sessions().logout(first.refreshToken);
  await assert.rejects(sessions().refresh(rotated.refreshToken, client));
  assert.equal(await prisma.refreshToken.count({ where: { sessionId: other.sessionId, revoked: false } }), 1);
});

test('F02: deleting every Redis marker does not restore durable revoked sessions; subject is bound too', async () => {
  const user = await account();
  const token = await issuer.issue(user.id, 'user', client);
  const store = new RevokedSessionStore({ client: { exists: async () => 0 } }, prisma);
  assert.equal(await store.has(token.sessionId, user.id), false);
  assert.equal(await store.has(token.sessionId, randomUUID()), true);
  await revocations.endAllSessions(user.id);
  assert.equal(await store.has(token.sessionId, user.id), true);
});

test('F01/F02: genuine signed tokens lose contacts on both public HTTP routes after every termination path', async () => {
  const { createServer } = require('node:http');
  const { generateKeyPairSync } = require('node:crypto');
  const jwt = require('jsonwebtoken');
  const { Test } = require('@nestjs/testing');
  const { PassportModule } = require('@nestjs/passport');
  const shared = require('../../shared/dist');
  const { resetAuthKeySet } = require('../../shared/dist/auth/auth-key-set');
  const { JwtStrategy: LocalStrategy } = require('../../authentication/dist/auth/jwt.strategy');
  const { PublicPropertiesController } = require('../../property/dist/properties/public-properties.controller');
  const { SearchController } = require('../../property/dist/search/search.controller');
  const { PropertyQueryService } = require('../../property/dist/properties/services/property-query.service');
  const { GuestSessionService } = require('../../property/dist/properties/services/guest-session.service');
  const { ClosestListingsService } = require('../../property/dist/properties/services/closest-listings.service');
  const { SearchService } = require('../../property/dist/search/search.service');
  const { ContactDetailsInterceptor } = require('../../property/dist/properties/contact-details');
  const { enableApiVersioning } = require('@tilomnov/shared/api-versions');
  const { authenticateSocket } = require('../../chat/dist/chat/ws-auth');
  const { EventEmitter } = require('node:events');
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const store = new RevokedSessionStore({ client: { exists: async () => 0 } }, prisma);
  const strategy = new LocalStrategy(store, { publishedKey: () => keys.publicKey });
  const auth = createServer(async (request, response) => {
    if (request.url === '/v1/auth/.well-known/jwks.json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'security-fixture', alg: 'RS256', use: 'sig' }] })); return;
    }
    try {
      assert.equal(request.url, '/internal/sessions/verify');
      const claims = jwt.verify(request.headers.authorization?.slice(7), keys.publicKey, { algorithms: ['RS256'] });
      await strategy.validate(claims); response.statusCode = 204;
    } catch { response.statusCode = 401; }
    response.end();
  });
  await new Promise((resolve) => auth.listen(0, '127.0.0.1', resolve));
  const oldAuth = process.env.AUTH_SERVICE_URL;
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${auth.address().port}`; resetAuthKeySet();
  let app;
  try {
    const rates = { create: () => ({ consume: async () => {} }) };
    const listing = randomUUID(), publisher = randomUUID();
    const module = await Test.createTestingModule({
      imports: [PassportModule], controllers: [PublicPropertiesController, SearchController],
      providers: [shared.JwtStrategy, ContactDetailsInterceptor,
        { provide: shared.RateLimits, useValue: rates },
        { provide: PropertyQueryService, useValue: { findPublic: async () => ({ id: listing, contactPhone: '+85512345678' }) } },
        { provide: GuestSessionService, useValue: {} }, { provide: ClosestListingsService, useValue: {} },
        { provide: SearchService, useValue: { publisher: async () => ({ person: { id: publisher, phone: '+85512345678', email: null }, listings: [] }) } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false }); enableApiVersioning(app);
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const paths = [`/v1/public/properties/${listing}`, `/v1/public/search/people/${publisher}`];
    const reveal = async (token, wanted) => {
      for (const route of paths) {
        const response = await fetch(base + route, { headers: token ? { authorization: `Bearer ${token}` } : {} });
        assert.equal(response.status, 200);
        assert.equal(JSON.stringify(await response.json()).includes('+85512345678'), wanted);
      }
    };
    await reveal(null, false);
    for (const reason of ['logout', 'password-reset', 'ban', 'deactivate']) {
      const user = await account(); const session = await issuer.issue(user.id, 'user', client);
      const access = jwt.sign({ sub: user.id, sid: session.sessionId, role: 'user', typ: 'access' }, keys.privateKey, { algorithm: 'RS256', keyid: 'security-fixture', expiresIn: 60 });
      await reveal(access, true);
      const socket = Object.assign(new EventEmitter(), { handshake: { headers: {}, auth: { token: access } }, data: {}, disconnect() { this.emit('disconnect'); } });
      await authenticateSocket(socket, { has: async () => false }); socket.disconnect();
      if (reason === 'ban') await prisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });
      else if (reason === 'deactivate') await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: new Date() } });
      else { if (reason === 'password-reset') await users.update(user.id, { password_hash: 'new-fixture-password' }); await revocations.endAllSessions(user.id); }
      await reveal(access, false);
      await assert.rejects(authenticateSocket(socket, { has: async () => false }));
    }
  } finally {
    await app?.close(); await new Promise((resolve) => auth.close(resolve));
    if (oldAuth === undefined) delete process.env.AUTH_SERVICE_URL; else process.env.AUTH_SERVICE_URL = oldAuth;
    resetAuthKeySet();
  }
});

test('F05: concurrent first-password writes have one winner and never replace it', async () => {
  const user = await prisma.user.create({ data: { passwordHash: 'unusable', hasPassword: false, firebaseUid: randomUUID() } });
  const results = await Promise.allSettled(['first', 'second'].map((hash) => users.createInitialPassword(user.id, user.firebaseUid, hash)));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const saved = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(saved.hasPassword, true);
  assert.ok(['first', 'second'].includes(saved.passwordHash));
  await assert.rejects(users.createInitialPassword(user.id, user.firebaseUid, 'replacement'));
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).passwordHash, saved.passwordHash);
});

test('F08: concurrent reservations count unconfirmed objects; cleanup frees slots only after deletion', async () => {
  const user = await account();
  const property = await prisma.property.create({ data: { userId: user.id, title: 'Fixture', price: 100, propertyType: 'Land' } });
  const removed = [];
  const storage = { getPublicUrl: (path) => `https://fixture.invalid/${path}`, isUploadedFileName: () => true, removeUploadedFiles: async (paths) => removed.push(...paths) };
  const reservations = new PropertyUploadReservations(prisma, storage, new UploadBudgets(prisma));
  const names = () => Array.from({ length: 20 }, () => `${user.id}/${property.id}/${randomUUID()}-fixture.jpg`);
  const results = await Promise.allSettled([reservations.reserve(user.id, property.id, names()), reservations.reserve(user.id, property.id, names())]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const pending = await prisma.propertyUploadReservation.findMany({ where: { userId: user.id } });
  assert.equal(pending.length, 20);
  await prisma.propertyUploadReservation.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 4 * 3600000), expiresAt: new Date(Date.now() - 3600000) } });
  await assert.rejects(prisma.$transaction((tx) => reservations.confirm(tx, user.id, property.id, [pending[0].path])));
  await reservations.cleanup();
  assert.equal(removed.length, 20);
  assert.equal(await prisma.propertyUploadReservation.count({ where: { userId: user.id, cleanedAt: null } }), 0);
  await reservations.reserve(user.id, property.id, names());
});

test('F08: failed cleanup retains its charge and attached photos are never deleted', async () => {
  const user = await account();
  const property = await prisma.property.create({ data: { userId: user.id, title: 'Cleanup fixture', price: 100, propertyType: 'Land' } });
  const paths = [0, 1].map(() => `${user.id}/${property.id}/${randomUUID()}-fixture.jpg`);
  let fail = true;
  const removed = [];
  const storage = { getPublicUrl: (path) => `https://fixture.invalid/${path}`, isUploadedFileName: () => true,
    removeUploadedFiles: async (names) => { if (fail) throw new Error('storage unavailable'); removed.push(...names); } };
  const reservations = new PropertyUploadReservations(prisma, storage, new UploadBudgets(prisma));
  await reservations.reserve(user.id, property.id, paths);
  await prisma.propertyUploadReservation.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 4 * 3600000), expiresAt: new Date(Date.now() - 3600000) } });
  await assert.rejects(reservations.cleanup(), /storage unavailable/);
  assert.equal(await prisma.propertyUploadReservation.count({ where: { userId: user.id, cleanedAt: null } }), 2);
  await prisma.propertyImage.create({ data: { propertyId: property.id, url: storage.getPublicUrl(paths[0]), order: 0 } });
  fail = false;
  await reservations.cleanup();
  assert.deepEqual(removed, [paths[1]]);
  assert.equal(await prisma.propertyImage.count({ where: { propertyId: property.id } }), 1);
});

test('F08: daily issuance counters survive concurrency without overspending', async () => {
  const userId = randomUUID();
  const budgets = new UploadBudgets(prisma);
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => budgets.take(userId, 'avatar')));
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 20);
  assert.equal((await prisma.uploadBudget.findFirst({ where: { userId } })).issuedCount, 20);
});

test('H02: every non-auth role is denied password hashes and auth-state writes, while required profile reads work', async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  try {
    for (const role of ['user_service', 'property_service', 'chat_service', 'notification_service']) {
      await db.query(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT password_hash FROM account.users LIMIT 1'), { code: '42501' });
      await assert.rejects(db.query("UPDATE account.users SET role='admin' WHERE false"), { code: '42501' });
      await assert.rejects(db.query("UPDATE account.users SET password_hash='forged' WHERE false"), { code: '42501' });
      await db.query('SELECT id, username, name, role, avatar_url, deactivated_at, banned_at FROM account.users LIMIT 1');
      await db.query('RESET ROLE');
    }
  } finally { await db.end(); }
});

test('H01: real RabbitMQ permissions isolate producers, consumers and retry queues', async () => {
  const amqp = require('amqplib');
  const { setupMessageTopology, sourceExchange, queueName } = require('../../shared/dist/messaging/rabbit-transport');
  const { permissions } = require('../../scripts/security/provision-rabbitmq.cjs');
  const { MessageBus } = require('../../shared/dist/messaging/message-bus');
  const suffix = randomUUID().replaceAll('-', '');
  const vhost = `security_fixture_${suffix}`;
  const accounts = ['chat', 'notification'].map((service) => ({ service, user: `fixture_${suffix}_${service}`, password: randomUUID() + randomUUID() }));
  const connections = [];
  const management = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:15679/api/${route}`, {
      method, headers: { authorization: `Basic ${Buffer.from('messaging_test:messaging_test').toString('base64')}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, `Fixture broker API status ${response.status}`);
  };
  const connect = async (user, password) => {
    const connection = await amqp.connect({ hostname: '127.0.0.1', port: 5679, username: user, password, vhost });
    connection.on('error', () => {}); connections.push(connection); return connection;
  };
  try {
    await management('PUT', `vhosts/${vhost}`, {});
    await management('PUT', `permissions/${vhost}/messaging_test`, { configure: '.*', write: '.*', read: '.*' });
    const admin = await connect('messaging_test', 'messaging_test');
    const topology = await admin.createConfirmChannel(); await setupMessageTopology(topology); await topology.close();
    for (const account of accounts) {
      await management('PUT', `users/${account.user}`, { password: account.password, tags: '' });
      await management('PUT', `permissions/${vhost}/${account.user}`, permissions(account.service));
    }
    const chat = await connect(accounts[0].user, accounts[0].password);
    const notification = await connect(accounts[1].user, accounts[1].password);
    const forbidden = async (operation) => {
      const channel = await chat.createConfirmChannel(); channel.on('error', () => {});
      try { await assert.rejects(operation(channel), /ACCESS_REFUSED|403|channel closed/i); }
      finally { await channel.close().catch(() => {}); }
    };
    await forbidden((channel) => channel.consume(queueName('authentication'), () => {}, { noAck: true }));
    const publish = (channel, exchange, routingKey, content) => new Promise((resolve, reject) => {
      channel.once('error', reject); channel.publish(exchange, routingKey, content, { persistent: true }, (error) => error ? reject(error) : resolve());
    });
    await forbidden((channel) => publish(channel, sourceExchange('authentication'), 'notification', Buffer.from('{}')));
    await forbidden((channel) => publish(channel, '', queueName('authentication'), Buffer.from('{}')));
    await forbidden((channel) => channel.assertExchange('unowned-exchange', 'direct'));

    const now = Date.now();
    const envelope = { id: randomUUID(), version: 1, type: 'notification.sign-in.v1', source: 'authentication', destination: 'notification', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), payload: {} };
    const writer = await chat.createConfirmChannel(); writer.on('error', () => {});
    await publish(writer, sourceExchange('chat'), 'notification', Buffer.from(JSON.stringify(envelope)));
    const reader = await notification.createConfirmChannel(); reader.on('error', () => {});
    const delivery = await reader.get(queueName('notification'), { noAck: false });
    assert.ok(delivery);
    assert.equal(delivery.fields.exchange, sourceExchange('chat'));
    let handled = false, deadLettered = false;
    const old = process.env.RABBITMQ_URL; process.env.RABBITMQ_URL = 'amqp://fixture@127.0.0.1';
    const bus = new MessageBus({}, 'notification');
    if (old === undefined) delete process.env.RABBITMQ_URL; else process.env.RABBITMQ_URL = old;
    bus.handle('notification.sign-in.v1', async () => { handled = true; });
    Object.assign(bus, { store: { processOnce: async (_message, work) => work() }, transport: { send: async (_exchange, route) => { deadLettered = route.endsWith('.dead'); } } });
    await bus.receive(reader, delivery);
    assert.equal(handled, false, 'A schema-valid forged source must not invoke authentication-owned work');
    assert.equal(deadLettered, true);
    await writer.close(); await reader.close();
  } finally {
    for (const connection of connections.reverse()) await connection.close().catch(() => {});
    await management('DELETE', `vhosts/${vhost}`);
    for (const account of accounts) await management('DELETE', `users/${account.user}`);
  }
});
