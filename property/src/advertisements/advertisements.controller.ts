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
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { AdvertisementsService } from './advertisements.service';
import { AdUploadDto, CreateAdDto } from './advertisements.dto';

@Controller('public/ads')
export class PublicAdvertisementsController {
  constructor(private readonly ads: AdvertisementsService) {}
  @Get() list() {
    return this.ads.list();
  }
}

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/ads', version: VERSION_NEUTRAL })
export class InternalAdvertisementsController {
  constructor(private readonly ads: AdvertisementsService) {}
  @Get() list() {
    return this.ads.list();
  }
  @Post('uploads') upload(@Body() dto: AdUploadDto) {
    return this.ads.upload(dto.actorId);
  }
  @Post() create(@Body() dto: CreateAdDto) {
    return this.ads.create(dto.actorId, dto.path);
  }
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.ads.remove(id);
  }
}
