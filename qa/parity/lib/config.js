'use strict';
const path = require('node:path');
const fs = require('node:fs');

const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/** The gateways under test. Both deploy from `main`; staging runs on the staging database. */
const ENVIRONMENTS = {
  staging: {
    name: 'staging',
    baseUrl:
      process.env.QA_STAGING_URL ||
      'https://gateway-staging-c9ff.up.railway.app',
  },
  production: {
    name: 'production',
    baseUrl:
      process.env.QA_PRODUCTION_URL || 'https://tilomnovgateway.sparkbytekh.com',
  },
};

/**
 * The three fixed QA accounts, the same numbers in every environment (each has
 * its own database). +1 202 555 01xx is a fictional range: no real person has
 * these numbers, so registration can never take one from a real user.
 */
const ROLES = {
  seller: { phone: '+12025550171', name: 'Tilomnov QA Seller (automated test)' },
  buyer: { phone: '+12025550172', name: 'Tilomnov QA Buyer (automated test)' },
  outsider: { phone: '+12025550173', name: 'Tilomnov QA Outsider (automated test)' },
};

/** Every listing and saved search the suite creates starts with this, so leftovers can be found. */
const QA_MARK = '[QA automated test]';

/**
 * Test listings sit in the empty South Pacific (near Point Nemo): no real
 * user's map, saved-search box or "closest" list is anywhere near it.
 */
const QA_SPOT = { lat: -48.8767, lng: -123.3933 };
const QA_AREA = { minLat: -49.5, maxLat: -48.2, minLng: -124.2, maxLng: -122.6 };

/** Gateway allows 300 requests a minute per address; stay well under it. */
const MIN_REQUEST_GAP_MS = 230;

function passwordFor(envName) {
  const value = process.env[`QA_PASSWORD_${envName.toUpperCase()}`];
  if (!value) {
    throw new Error(
      `QA_PASSWORD_${envName.toUpperCase()} is not set. Copy qa/parity/.env.example to .env and fill it in.`,
    );
  }
  return value;
}

module.exports = {
  ENVIRONMENTS,
  ROLES,
  QA_MARK,
  QA_SPOT,
  QA_AREA,
  MIN_REQUEST_GAP_MS,
  passwordFor,
};
