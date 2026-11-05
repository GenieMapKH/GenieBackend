'use strict';
const { MIN_REQUEST_GAP_MS } = require('./config');

const API_PREFIX = '/v1';
const TIMEOUT_MS = 30_000;

/** Waits so that requests leave at most one per MIN_REQUEST_GAP_MS. */
class Pacer {
  constructor(gapMs) {
    this.gapMs = gapMs;
    this.next = 0;
  }

  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.gapMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

/** Fills `:name` placeholders: `/properties/:id` + `{ id }`. */
function fillPath(template, params = {}) {
  return template.replace(/:([A-Za-z]+)/g, (_, name) => {
    if (params[name] === undefined) throw new Error(`Missing path param :${name} in ${template}`);
    return encodeURIComponent(params[name]);
  });
}

function queryString(query) {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The gateway as the app sees it: `/v1` paths, a bearer token, the app's
 * device headers. Every request is paced; a dropped connection is retried
 * once and reported, so a flaky network never reads as a server difference.
 */
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.pacer = new Pacer(MIN_REQUEST_GAP_MS);
    this.retries = [];
  }

  /** Returns `{ status, body, ms, headers }`; network failures give status 0. */
  async request(method, template, options = {}) {
    const { params, query, body, token, headers = {}, unversioned = false } = options;
    const path = (unversioned ? '' : API_PREFIX) + fillPath(template, params);
    const url = this.baseUrl + path + queryString(query);
    const init = {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    };
    try {
      return await this.send(url, init);
    } catch (first) {
      this.retries.push(`${method} ${template}: ${first.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        return await this.send(url, init);
      } catch (second) {
        return { status: 0, body: { networkError: second.message }, ms: 0, headers: {} };
      }
    }
  }

  async send(url, init) {
    await this.pacer.wait();
    const started = Date.now();
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await readBody(response);
    return {
      status: response.status,
      body,
      ms: Date.now() - started,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  /** A raw upload to a storage URL the API handed out (not the gateway, so not paced). */
  async upload(url, bytes, contentType, method = 'PUT') {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': contentType },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await readBody(response) };
  }
}

module.exports = { ApiClient, fillPath };
