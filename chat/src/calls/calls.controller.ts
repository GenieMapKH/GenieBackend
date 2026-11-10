import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@tilomnov/shared';
import { CallHistoryEntry, CallHistoryService } from './call-history.service';
import { CallHistoryQuery } from './dto/call.dto';
import { IceServer, IceServersService } from './ice-servers.service';

@ApiTags('calls')
@Controller('chat/calls')
export class CallsController {
  constructor(
    private readonly iceServers: IceServersService,
    private readonly history: CallHistoryService,
  ) {}

  /** Asked before each call: the TURN password in it expires. */
  @Get('ice-servers')
  getIceServers(
    @CurrentUserId() userId: string,
  ): Promise<{ iceServers: IceServer[] }> {
    return this.iceServers.forUser(userId);
  }

  /** The finished calls with one person, oldest first, to show among the messages. */
  @Get('history')
  getHistory(
    @CurrentUserId() userId: string,
    @Query() query: CallHistoryQuery,
  ): Promise<CallHistoryEntry[]> {
    return this.history.between(userId, query.with, query.limit);
  }
}
