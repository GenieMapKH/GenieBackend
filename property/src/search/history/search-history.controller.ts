import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUserId, RateLimit, RateLimits } from '@tilomnov/shared';
import { RecordSearchDto } from './record-search.dto';
import { SearchHistoryService } from './search-history.service';

/** The signed-in user's own searches. The gateway requires a token here. */
@ApiTags('search')
@Controller('search/history')
export class SearchHistoryController {
  /** One per finished search: generous, but a script cannot fill the table. */
  private readonly recordLimiter: RateLimit;

  constructor(
    private readonly history: SearchHistoryService,
    rateLimits: RateLimits,
  ) {
    this.recordLimiter = rateLimits.create('search-history', 60, 60);
  }

  @Get()
  @ApiOperation({ summary: 'My searches of the last 14 days, newest first' })
  list(@CurrentUserId() userId: string) {
    return this.history.list(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Remember a search (the same text again moves it to the top)',
  })
  @ApiResponse({ status: 429, description: 'Too many searches' })
  async record(@CurrentUserId() userId: string, @Body() dto: RecordSearchDto) {
    try {
      await this.recordLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.history.record(userId, dto.query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Forget one of my searches' })
  @ApiResponse({ status: 404, description: 'No such search of mine' })
  remove(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.history.remove(userId, id);
  }
}
