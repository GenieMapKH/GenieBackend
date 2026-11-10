import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@tilomnov/shared';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './saved-search.dto';
import {
  MAX_SAVED_SEARCHES,
  SavedSearchesService,
} from './saved-searches.service';

/** The signed-in user's saved map searches. The gateway requires a token here. */
@ApiTags('search')
@Controller('search/saved')
export class SavedSearchesController {
  constructor(private readonly saved: SavedSearchesService) {}

  @Get()
  @ApiOperation({ summary: 'My saved searches, newest first' })
  list(@CurrentUserId() userId: string) {
    return this.saved.list(userId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Save the map area and filter; new listings matching it are pushed while alerts is on',
  })
  @ApiResponse({ status: 400, description: 'Invalid area or filter' })
  @ApiResponse({
    status: 409,
    description: `Already ${MAX_SAVED_SEARCHES} saved searches`,
  })
  create(@CurrentUserId() userId: string, @Body() dto: CreateSavedSearchDto) {
    return this.saved.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a saved search or turn its alerts on/off' })
  @ApiResponse({ status: 404, description: 'Not one of mine' })
  update(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedSearchDto,
  ) {
    return this.saved.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Forget a saved search' })
  async remove(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.saved.remove(userId, id);
  }
}
