// What run.js and bootstrap.js take from the environment.
const { Client } = require('pg');
const { databaseConnectionOptions } = require('../../shared/dist/prisma/database-connection-options');
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

/** A connected client with the same verified TLS policy as the services. */
async function connectTo(url) {
  const client = new Client({ ...databaseConnectionOptions(url), connectionTimeoutMillis: 10_000 });
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
