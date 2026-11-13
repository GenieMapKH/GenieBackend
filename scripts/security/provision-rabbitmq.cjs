// Explicit operator action only. Default prints permissions, never credentials; --apply provisions them.
const { SERVICES } = require('../../shared/dist/messaging/message-contracts');
const { MESSAGE_EXCHANGE, queueName, deadQueueName, retryQueueName, RETRY_DELAYS_MS, setupMessageTopology } = require('../../shared/dist/messaging/rabbit-transport');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function permissions(service) {
  const writable = [`${MESSAGE_EXCHANGE}.${service}`, deadQueueName(service), ...RETRY_DELAYS_MS.map((_, i) => retryQueueName(service, i))];
  return { configure: '^$', write: `^(${writable.map(escape).join('|')})$`, read: `^${escape(queueName(service))}$` };
}
async function provision(env = process.env, apply = false) {
  const plan = SERVICES.map((service) => ({ service, user: `tilomnov_${service}`, permissions: permissions(service) }));
  if (!apply) return plan;
  const base = new URL(env.RABBITMQ_MANAGEMENT_URL);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', 'rabbitmq'].includes(base.hostname))
    throw new Error('Management API requires HTTPS outside the local fixture');
  const vhost = env.RABBITMQ_VHOST || 'tilomnov';
  const auth = Buffer.from(`${env.RABBITMQ_ADMIN_USER}:${env.RABBITMQ_ADMIN_PASSWORD}`).toString('base64');
  for (const { service } of plan) {
    if ((env[`RABBITMQ_${service.toUpperCase()}_PASSWORD`] || '').length < 32)
      throw new Error(`A unique 32+ character password is required for ${service}`);
  }
  const passwords = plan.map(({ service }) => env[`RABBITMQ_${service.toUpperCase()}_PASSWORD`]);
  if (new Set(passwords).size !== SERVICES.length) throw new Error('Broker passwords must be distinct');
  const connection = await require('amqplib').connect({
    protocol: env.RABBITMQ_PROTOCOL || 'amqp', hostname: env.RABBITMQ_HOST || base.hostname,
    port: Number(env.RABBITMQ_PORT || 5672), vhost,
    username: env.RABBITMQ_ADMIN_USER, password: env.RABBITMQ_ADMIN_PASSWORD,
  });
  try { const channel = await connection.createConfirmChannel(); await setupMessageTopology(channel); await channel.close(); }
  finally { await connection.close(); }
  for (const { service, user, permissions: permission } of plan) {
    for (const [route, body] of [
      [`users/${encodeURIComponent(user)}`, { password: env[`RABBITMQ_${service.toUpperCase()}_PASSWORD`], tags: '' }],
      [`permissions/${encodeURIComponent(vhost)}/${encodeURIComponent(user)}`, permission],
    ]) {
      const response = await fetch(new URL(`/api/${route}`, base), {
        method: 'PUT', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Broker provisioning failed (${response.status})`);
    }
  }
  return plan;
}
module.exports = { permissions, provision };
if (require.main === module) provision(process.env, process.argv.includes('--apply'))
  .then((plan) => console.log(JSON.stringify({ applied: process.argv.includes('--apply'), plan }, null, 2)))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
