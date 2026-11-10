import { Injectable, Logger } from '@nestjs/common';
import { BlockList, isIP } from 'net';

/**
 * Turns an IP address into a rough place name for "Logged-in devices".
 * Sessions depend on this class only, so the lookup service behind it can be
 * swapped without touching them.
 */
export abstract class IpLocationProvider {
  /** e.g. "Phnom Penh, Cambodia". Null when unknown. Never throws. */
  abstract locate(ipAddress: string): Promise<string | null>;
}

/** Addresses that are not on the public internet, so no service can place them. */
const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv4');
}
PRIVATE_RANGES.addAddress('::1', 'ipv6');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');

/** True for a well-formed address that a lookup service could know about. */
export function isPublicAddress(ipAddress: string): boolean {
  // Node reports IPv4 clients on a dual-stack socket as "::ffff:1.2.3.4".
  const address = ipAddress.replace(/^::ffff:/i, '');
  const version = isIP(address);
  if (version === 0) return false;
  return !PRIVATE_RANGES.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

const DEFAULT_API_URL = 'https://ipwho.is';
const DISABLED = 'off';
const TIMEOUT_MS = 3000;

interface IpWhoIsAnswer {
  success?: boolean;
  city?: string;
  country?: string;
}

/**
 * Looks addresses up at ipwho.is (free, no key). `IP_LOCATION_API_URL` points
 * it at another server with the same API, or switches it off with "off".
 * Only the IP address is sent, never who it belongs to.
 */
@Injectable()
export class IpWhoIsLocationProvider extends IpLocationProvider {
  private readonly logger = new Logger(IpWhoIsLocationProvider.name);
  private readonly apiUrl = (
    process.env.IP_LOCATION_API_URL || DEFAULT_API_URL
  ).replace(/\/+$/, '');

  async locate(ipAddress: string): Promise<string | null> {
    if (this.apiUrl === DISABLED || !isPublicAddress(ipAddress)) return null;

    try {
      const response = await fetch(
        `${this.apiUrl}/${encodeURIComponent(ipAddress)}?fields=success,city,country`,
        {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) return null;

      const answer = (await response.json()) as IpWhoIsAnswer;
      if (!answer.success) return null;
      return [answer.city, answer.country].filter(Boolean).join(', ') || null;
    } catch (error) {
      // A device list without a place is better than a failed login.
      this.logger.warn(
        `Could not look up a location: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
