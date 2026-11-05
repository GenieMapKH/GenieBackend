'use strict';
const { io } = require('socket.io-client');

const CONNECT_TIMEOUT_MS = 15_000;
const EVENT_TIMEOUT_MS = 10_000;

/**
 * The chat socket as the app opens it: `<gateway>/chat`, websocket only,
 * `auth: { token, apiVersion }`. Every event received is kept so a case can
 * wait for one that may already have arrived.
 */
class ChatSocket {
  constructor(socket) {
    this.socket = socket;
    this.received = [];
    this.waiters = [];
    socket.onAny((event, payload) => {
      this.received.push({ event, payload });
      this.waiters = this.waiters.filter((waiter) => !waiter.offer(event, payload));
    });
  }

  /** Resolves with the first `event` whose payload passes `matches`, or null after the timeout. */
  waitFor(event, matches = () => true, timeoutMs = EVENT_TIMEOUT_MS) {
    const already = this.received.find((item) => item.event === event && matches(item.payload));
    if (already) return Promise.resolve(already.payload);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== entry);
        resolve(null);
      }, timeoutMs);
      const entry = {
        offer: (name, payload) => {
          if (name !== event || !matches(payload)) return false;
          clearTimeout(timer);
          resolve(payload);
          return true;
        },
      };
      this.waiters.push(entry);
    });
  }

  /** Emits with an acknowledgement; resolves with the ack, or `{ status: 'timeout' }`. */
  async emitAck(event, payload, timeoutMs = EVENT_TIMEOUT_MS) {
    try {
      return await this.socket.timeout(timeoutMs).emitWithAck(event, payload);
    } catch {
      return { status: 'timeout' };
    }
  }

  close() {
    this.socket.disconnect();
  }
}

/** Resolves `{ socket }` once connected, or `{ error }` with the handshake refusal. */
function connectChat(baseUrl, { token, apiVersion = '1' }) {
  const socket = io(`${baseUrl}/chat`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS,
    auth: { ...(token !== undefined && { token }), apiVersion },
  });
  return new Promise((resolve) => {
    socket.once('connect', () => resolve({ socket: new ChatSocket(socket) }));
    socket.once('connect_error', (error) => {
      socket.disconnect();
      resolve({ error: error.message });
    });
  });
}

module.exports = { connectChat };
