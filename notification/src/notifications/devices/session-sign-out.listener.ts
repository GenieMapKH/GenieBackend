import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RevokedSessions } from '@tilomnov/shared';
import { PushDevicesService } from './push-devices.service';

/**
 * A device signed out from another device (or by "sign out everywhere")
 * cannot unregister itself, so its token is dropped here the moment the
 * authentication service announces the sign-out.
 */
@Injectable()
export class SessionSignOutListener implements OnModuleInit {
  private readonly logger = new Logger(SessionSignOutListener.name);

  constructor(
    private readonly revokedSessions: RevokedSessions,
    private readonly devices: PushDevicesService,
  ) {}

  onModuleInit() {
    this.revokedSessions.onRevoked((sessionId) => {
      this.devices
        .forgetSession(sessionId)
        .catch((error: Error) =>
          this.logger.error(
            `Devices of a signed-out session kept: ${error.message}`,
          ),
        );
    });
  }
}
