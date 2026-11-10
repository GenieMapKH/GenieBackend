import type { IceServer } from './ice-servers.service';

const API_URL = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/** A call must not wait long on the relay; past this it starts without one. */
const TIMEOUT_MS = 4000;

interface GenerateIceServersResponse {
  iceServers?: {
    urls?: string | string[];
    username?: string;
    credential?: string;
  }[];
}

/** Cloudflare answered with an error status or an unexpected body. */
export class CloudflareTurnError extends Error {}

/**
 * Cloudflare's TURN service: short-lived relay credentials, asked for with a
 * TURN key that stays on the server. The answer already includes
 * Cloudflare's STUN server.
 */
export class CloudflareTurnClient {
  constructor(
    private readonly keyId: string,
    private readonly apiToken: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async iceServers(ttlSeconds: number): Promise<IceServer[]> {
    const response = await this.fetchFn(
      `${API_URL}/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: ttlSeconds }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok)
      throw new CloudflareTurnError(
        `Cloudflare TURN answered ${response.status}`,
      );

    const body = (await response.json()) as GenerateIceServersResponse;
    const servers = (body.iceServers ?? [])
      .map((server) => ({
        urls:
          typeof server.urls === 'string' ? [server.urls] : (server.urls ?? []),
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      }))
      .filter((server) => server.urls.length > 0);
    if (servers.length === 0)
      throw new CloudflareTurnError('Cloudflare TURN sent no servers');
    return servers;
  }
}
