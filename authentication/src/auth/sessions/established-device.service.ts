import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  RefreshTokenRecord,
  RefreshTokenRepository,
} from './refresh-token.repository';

/** The session a request comes from. `sessionId` is null for a token from before sessions existed. */
export interface SessionCaller {
  userId: string;
  sessionId: string | null;
}

/** Whether a device may act against the account's other devices, and from when. */
export interface EstablishedStatus {
  isEstablished: boolean;
  /** When it becomes established. Null if the device's own session is not known. */
  from: Date | null;
}

/** How long a device must have been signed in to count as established. */
export const ESTABLISHED_AFTER_MS = 24 * 60 * 60 * 1000;

/** In the `403` body, so the app can tell this refusal from a wrong password. */
export const DEVICE_TOO_NEW = 'DEVICE_TOO_NEW';

/** When the sign-in behind a token happened. */
export function sessionStartOf(token: RefreshTokenRecord): string {
  return token.session_started_at ?? token.created_at;
}

/**
 * The one-day rule: only a device that has been signed in for a day may take
 * the account away from its other devices (sign them out, change the
 * password, deactivate or delete the account).
 *
 * Someone who just got into an account, with a stolen password for one, could
 * otherwise lock its owner out at once. This way the owner's own, older
 * devices can remove the newcomer first. A device can always sign itself out.
 */
@Injectable()
export class EstablishedDeviceService {
  constructor(
    @Inject(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  /** `403` with `code: DEVICE_TOO_NEW` while the caller's device is not established. */
  async require(caller: SessionCaller): Promise<void> {
    const status = this.statusAmong(
      await this.refreshTokens.listSessionTokens(caller.userId),
      caller,
    );
    if (status.isEstablished) return;

    throw new ForbiddenException({
      statusCode: HttpStatus.FORBIDDEN,
      code: DEVICE_TOO_NEW,
      message:
        'This device signed in less than a day ago. To protect the account it cannot do this yet.',
      canSignOutOthersFrom: status.from?.toISOString() ?? null,
    });
  }

  /** The caller's status, given the account's session tokens (to save reading them twice). */
  statusAmong(
    tokens: RefreshTokenRecord[],
    caller: SessionCaller,
  ): EstablishedStatus {
    const own = tokens.find((token) => token.session_id === caller.sessionId);
    if (!own) return { isEstablished: false, from: null };

    const from = new Date(
      new Date(sessionStartOf(own)).getTime() + ESTABLISHED_AFTER_MS,
    );
    return { isEstablished: from.getTime() <= Date.now(), from };
  }
}
