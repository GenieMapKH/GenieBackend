import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { RevokedSessions } from '@tilomnov/shared';
import { authenticateSocket } from './ws-auth';

/** Re-checks the socket's token on every message, so expired and signed-out sessions are cut off. */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(private readonly revokedSessions: RevokedSessions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'ws') {
      return true;
    }

    const client = context.switchToWs().getClient<Socket>();
    try {
      await authenticateSocket(client, this.revokedSessions);
      return true;
    } catch (error) {
      this.logger.warn(
        `WebSocket authentication failed: ${(error as Error).message}`,
      );
      client.disconnect();
      return false;
    }
  }
}
