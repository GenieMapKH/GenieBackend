'use strict';
const { ApiClient } = require('./api-client');
const { CaseContext, CheckFailure } = require('./case-context');

const STATUS_MARK = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', error: 'ERROR' };

function missingNeeds(caseDef, state) {
  return (caseDef.needs ?? []).filter((key) => state[key] === undefined || state[key] === null);
}

async function runCase(caseDef, env, api, state) {
  const started = Date.now();
  const base = { id: caseDef.id, area: caseDef.area, title: caseDef.title };
  const missing = missingNeeds(caseDef, state);
  if (missing.length > 0) {
    return { ...base, status: 'skip', failures: [`Needs ${missing.join(', ')} from an earlier case that failed`], notes: [], steps: [], ms: 0 };
  }

  const context = new CaseContext({ env, api, state });
  let status = 'pass';
  const failures = [];
  try {
    await caseDef.run(context);
  } catch (error) {
    status = error instanceof CheckFailure ? 'fail' : 'error';
    failures.push(error instanceof CheckFailure ? error.message : `${error.name}: ${error.message}`);
  }
  if (context.softFailures.length > 0) {
    if (status === 'pass') status = 'fail';
    failures.push(...context.softFailures);
  }
  return { ...base, status, failures, notes: context.notes, steps: context.steps, ms: Date.now() - started };
}

/** Runs every case, in order, against one environment. Later cases use what earlier ones left in `state`. */
async function runEnvironment(env, cases, log = console.log) {
  const api = new ApiClient(env.baseUrl);
  const state = { env: env.name };
  const results = [];
  const started = Date.now();
  log(`\n=== ${env.name} (${env.baseUrl}) ===`);
  for (const caseDef of cases) {
    const result = await runCase(caseDef, env, api, state);
    results.push(result);
    const failure = result.failures[0] ? `  <- ${result.failures[0]}` : '';
    log(`${STATUS_MARK[result.status].padEnd(5)} ${result.id.padEnd(9)} ${result.title}${failure}`);
  }
  // A case that stopped early may have left sockets open; they would keep the process alive.
  for (const socket of Object.values(state.sockets ?? {})) socket.close();
  return {
    env: env.name,
    baseUrl: env.baseUrl,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    retries: api.retries,
    results,
  };
}

module.exports = { runEnvironment };
