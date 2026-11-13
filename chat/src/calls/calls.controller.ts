import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId, RateLimit, RateLimits } from '@tilomnov/shared';
import { CallHistoryEntry, CallHistoryService } from './call-history.service';
import { CallHistoryQuery } from './dto/call.dto';
import { IceServer, IceServersService } from './ice-servers.service';

@ApiTags('calls')
@Controller('chat/calls')
export class CallsController {
  private readonly relayBudget: RateLimit;
  constructor(
    private readonly iceServers: IceServersService,
    private readonly history: CallHistoryService,
    rateLimits: RateLimits,
  ) {
    this.relayBudget = rateLimits.create('turn-credentials', 30, 3600);
  }

  /** Asked before each call: the TURN password in it expires. */
  @Get('ice-servers')
  async getIceServers(
    @CurrentUserId() userId: string,
  ): Promise<{ iceServers: IceServer[] }> {
    await this.relayBudget.consume(userId).catch(() => {
      throw new HttpException(
        'Call connection budget exceeded. Try again later.',
        429,
      );
    });
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
