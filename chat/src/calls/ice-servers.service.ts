import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { CloudflareTurnClient } from './cloudflare-turn.client';

/** One server a phone may use to reach the other, as WebRTC names it. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Google's public STUN servers: enough when neither phone is behind a strict network. */
const DEFAULT_STUN =
  'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

/** TURN credentials last this long: longer than any call. */
const TURN_CREDENTIAL_SECONDS = 6 * 60 * 60;

/**
 * The servers that help two phones find each other. STUN finds a phone's
 * public address; TURN relays the audio when no direct path exists (most
 * calls between two mobile networks). TURN comes from, in order:
 * - Cloudflare, when `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`
 *   are set;
 * - a coturn server, when `TURN_URLS` and `TURN_SECRET` (its
 *   `static-auth-secret`) are set.
 * When Cloudflare cannot be reached the call still gets STUN (and coturn, if
 * set): it then connects only on easy networks.
 */
@Injectable()
export class IceServersService {
  private readonly logger = new Logger(IceServersService.name);
  private readonly cloudflare: CloudflareTurnClient | null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    fetchFn: typeof fetch = fetch,
  ) {
    const keyId = env.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = env.CLOUDFLARE_TURN_API_TOKEN;
    this.cloudflare =
      keyId && apiToken
        ? new CloudflareTurnClient(keyId, apiToken, fetchFn)
        : null;
  }

  async forUser(
    userId: string,
    now = Date.now(),
  ): Promise<{ iceServers: IceServer[] }> {
    if (this.cloudflare) {
      try {
        return {
          iceServers: await this.cloudflare.iceServers(TURN_CREDENTIAL_SECONDS),
        };
      } catch (error) {
        this.logger.error(
          `No Cloudflare TURN for this call: ${(error as Error).message}`,
        );
      }
    }
    return { iceServers: this.fromEnv(userId, now) };
  }

  private fromEnv(userId: string, now: number): IceServer[] {
    const iceServers: IceServer[] = [
      { urls: split(this.env.CALL_STUN_URLS || DEFAULT_STUN) },
    ];

    const turnUrls = split(this.env.TURN_URLS ?? '');
    const secret = this.env.TURN_SECRET;
    if (turnUrls.length > 0 && secret) {
      // The TURN REST API scheme: the username carries its own expiry.
      const username = `${Math.floor(now / 1000) + TURN_CREDENTIAL_SECONDS}:${userId}`;
      const credential = createHmac('sha1', secret)
        .update(username)
        .digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
    }
    return iceServers;
  }
}

function split(list: string): string[] {
  return list
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}
