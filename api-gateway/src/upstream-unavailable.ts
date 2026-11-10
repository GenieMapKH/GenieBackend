import { Logger } from '@nestjs/common';
import type { ServerResponse } from 'http';

const logger = new Logger('ServiceProxy');

/** Errors that mean the service took too long, as opposed to not being there at all. */
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET']);

/**
 * What a client sees when a service cannot be reached: a clear `503` (or `504`
 * for a service that did not answer in time) that names the service, so the
 * app can tell "chat is down" from "everything is down" and retry later. The
 * other services are not affected.
 */
export function respondUnavailable(
  service: string,
  error: NodeJS.ErrnoException,
  res: unknown,
) {
  // The reason (ECONNREFUSED: nothing listens there, ENOTFOUND: wrong host name, ETIMEDOUT...) is what an operator needs.
  logger.error(
    `The ${service} service could not be reached: ${error.code ?? ''} ${error.message} (${(error as { address?: string }).address ?? ''}:${(error as { port?: number }).port ?? ''})`,
  );

  if (!res || typeof (res as ServerResponse).writeHead !== 'function') {
    // A WebSocket upgrade: there is no HTTP response to write, so close the socket.
    (res as { destroy?: () => void } | undefined)?.destroy?.();
    return;
  }
  const response = res as ServerResponse;
  if (response.headersSent) {
    response.end();
    return;
  }

  const timedOut = TIMEOUT_CODES.has(error.code ?? '');
  const statusCode = timedOut ? 504 : 503;
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'retry-after': '5',
  });
  response.end(
    JSON.stringify({
      statusCode,
      error: timedOut ? 'Gateway Timeout' : 'Service Unavailable',
      message: `The ${service} service is not responding. Please try again shortly.`,
      service,
    }),
  );
}
