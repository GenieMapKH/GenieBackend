import { Socket } from 'socket.io';
import {
  ACCESS_TOKEN,
  RevokedSessions,
  verifySignedToken,
} from '@tilomnov/shared';

/** Who a socket belongs to. `sessionId` is null for a token from before sessions existed. */
export interface SocketUser {
  userId: string;
  sessionId: string | null;
  expiresAt: number;
}

const expiryTimers = new WeakMap<
  Socket,
  { expiresAt: number; timer: NodeJS.Timeout }
>();

/** Bearer token from the `Authorization` header, or the socket.io `auth.token` field. */
export function extractSocketToken(client: Socket): string | undefined {
  const header = client.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  const authToken: unknown = client.handshake.auth?.token;
  return typeof authToken === 'string' ? authToken : undefined;
}

/** The user stored on the socket by `authenticateSocket`. Only valid once the handshake or guard has passed. */
export function socketUser(client: Socket): SocketUser {
  return client.data as SocketUser;
}

/** Verifies an access token and returns who it was issued to. Throws if invalid. */
export async function verifyAccessToken(token: string): Promise<SocketUser> {
  const payload = await verifySignedToken(token, ACCESS_TOKEN);
  if (typeof payload.exp !== 'number')
    throw new Error('Access token has no expiry');
  return {
    userId: payload.sub,
    sessionId: typeof payload.sid === 'string' ? payload.sid : null,
    expiresAt: payload.exp * 1000,
  };
}

/**
 * Who the socket's token belongs to, written to `client.data`. Throws when
 * there is no valid token or its device was signed out.
 */
export async function authenticateSocket(
  client: Socket,
  revoked: RevokedSessions,
): Promise<SocketUser> {
  const token = extractSocketToken(client);
  if (!token) throw new Error('No token provided');

  const user = await verifyAccessToken(token);
  if (user.sessionId && (await revoked.has(user.sessionId))) {
    throw new Error('This device was signed out');
  }
  const expiresAt = user.expiresAt;
  const previous = expiryTimers.get(client);
  if (previous?.expiresAt !== expiresAt) {
    clearTimeout(previous?.timer);
    const timer = setTimeout(
      () => client.disconnect(true),
      Math.max(0, expiresAt - Date.now()),
    );
    timer.unref();
    expiryTimers.set(client, { expiresAt, timer });
    if (!previous)
      client.once('disconnect', () => {
        clearTimeout(expiryTimers.get(client)?.timer);
        expiryTimers.delete(client);
      });
  }
  Object.assign(client.data as object, user);
  return user;
}
