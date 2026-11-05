'use strict';
const { shapeOf } = require('./shape');

/** A failed expectation: ends the case, which is reported as failed. */
class CheckFailure extends Error {}

function statusMatches(status, expected) {
  return Array.isArray(expected) ? expected.includes(status) : status === expected;
}

function brief(body) {
  if (body === null || body === undefined) return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/**
 * What one test case sees: the API as a given QA account (or a guest), the
 * state shared between cases, and a record of every request it made. The
 * record (route, caller, status, response shape) is what is compared between
 * environments.
 */
class CaseContext {
  constructor({ env, api, state }) {
    this.env = env;
    this.api = api;
    this.state = state;
    this.steps = [];
    this.notes = [];
    this.softFailures = [];
  }

  session(role) {
    const session = this.state.sessions?.[role];
    if (!session) throw new CheckFailure(`No signed-in session for ${role}`);
    return session;
  }

  userId(role) {
    return this.session(role).userId;
  }

  /**
   * One request. `as` is a role, or null for a guest. With `expect` (a status
   * or a list), a different status ends the case with the response attached.
   */
  async call(as, method, template, options = {}) {
    const session = as ? this.session(as) : null;
    const response = await this.api.request(method, template, {
      ...options,
      token: options.token !== undefined ? options.token : session?.accessToken,
      headers: { ...(session?.deviceHeaders ?? {}), ...(options.headers ?? {}) },
    });
    const label = options.label ?? `${method} ${template}`;
    this.steps.push({
      label,
      as: as ?? 'guest',
      status: response.status,
      ms: response.ms,
      shape: shapeOf(response.body),
    });
    if (options.expect !== undefined && !statusMatches(response.status, options.expect)) {
      throw new CheckFailure(
        `${label} as ${as ?? 'guest'}: expected ${[].concat(options.expect).join('/')}, got ${response.status} ${brief(response.body)}`,
      );
    }
    return response;
  }

  /** Records a non-HTTP step (socket event, upload) so it is compared too. */
  record(label, as, outcome, body) {
    this.steps.push({ label, as, status: outcome, ms: 0, shape: shapeOf(body) });
  }

  /** A must: a false condition ends the case. */
  check(condition, message) {
    if (!condition) throw new CheckFailure(message);
  }

  /** A should: a false condition fails the case but lets it finish its steps. */
  soft(condition, message) {
    if (!condition) this.softFailures.push(message);
  }

  note(message) {
    this.notes.push(message);
  }
}

module.exports = { CaseContext, CheckFailure, brief };
