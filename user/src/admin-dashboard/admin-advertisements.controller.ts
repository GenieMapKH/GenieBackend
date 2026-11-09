import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { AdminGuard, CurrentUserId } from '@tilomnov/shared';
import { AdminPlatformService } from './admin-platform.service';

class AdPathDto {
  @IsString()
  @Matches(
    /^[0-9a-f-]{36}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
  path: string;
}
@UseGuards(AdminGuard)
@Controller('admin/ads')
export class AdminAdvertisementsController {
  constructor(private readonly platform: AdminPlatformService) {}
  @Get() list() {
    return this.platform.property('GET', 'ads');
  }
  @Post('uploads') upload(@CurrentUserId() actorId: string) {
    return this.platform.property('POST', 'ads/uploads', { actorId });
  }
  @Post() create(@CurrentUserId() actorId: string, @Body() dto: AdPathDto) {
    return this.platform.mutate(
      actorId,
      dto.path.split('/')[1],
      'ad.create',
      'Advertisement image added',
      () => this.platform.property('POST', 'ads', { actorId, path: dto.path }),
    );
  }
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUserId() actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platform.mutate(
      actorId,
      id,
      'ad.delete',
      'Advertisement image removed',
      () => this.platform.property('DELETE', `ads/${id}`),
    );
  }
}
