import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/** No positive cache: a missing Redis key must never restore an ended session. */
export async function requireActiveSession(token: string): Promise<void> {
  let response: Response;
  try {
    const base = (
      process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
    ).replace(/\/+$/, '');
    response = await fetch(`${base}/internal/sessions/verify`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceUnavailableException('Could not verify session');
  }
  if (response.status === 401 || response.status === 403)
    throw new UnauthorizedException('This device was signed out');
  if (response.status !== 204)
    throw new ServiceUnavailableException('Could not verify session');
}
