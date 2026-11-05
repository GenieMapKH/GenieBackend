// What run.js and bootstrap.js take from the environment.
const { Client } = require('pg');
const { InfisicalSecrets } = require('./infisical');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (docs/SECRET_ROTATION.md)`);
  return value;
}

/** Logged in as the machine identity. */
async function infisicalFromEnv() {
  const secrets = new InfisicalSecrets({
    apiUrl: process.env.INFISICAL_API_URL || 'https://app.infisical.com',
    projectId: required('INFISICAL_PROJECT_ID'),
    environment: process.env.INFISICAL_ENVIRONMENT || 'prod',
  });
  await secrets.login(required('INFISICAL_CLIENT_ID'), required('INFISICAL_CLIENT_SECRET'));
  return secrets;
}

/** A connected client. The URL's own settings (sslmode...) apply, as in the services. */
async function connectTo(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return client;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { infisicalFromEnv, connectTo, wait, required };
