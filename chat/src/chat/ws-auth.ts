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
}

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
  return {
    userId: payload.sub,
    sessionId: typeof payload.sid === 'string' ? payload.sid : null,
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
  Object.assign(client.data as object, user);
  return user;
}
