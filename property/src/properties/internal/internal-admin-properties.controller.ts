import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { AdminPropertiesService } from '../services/admin-properties.service';
import { PropertyImageService } from '../services/property-image.service';
import { PropertyLifecycleService } from '../services/property-lifecycle.service';
import { UpdatePropertyDto } from '../dto/update-property.dto';
import { BoundaryDto } from '../dto/boundary.dto';
import { ImageFileNamesDto } from '../dto/image-file-names.dto';
import { ImageUrlsDto } from '../dto/image-urls.dto';

class PropertyIdsDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) ids: string[];
}

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/properties', version: VERSION_NEUTRAL })
export class InternalAdminPropertiesController {
  constructor(
    private readonly properties: AdminPropertiesService,
    private readonly images: PropertyImageService,
    private readonly lifecycle: PropertyLifecycleService,
  ) {}
  @Post('batch')
  batch(@Body() dto: PropertyIdsDto) {
    return this.properties.batch(dto.ids);
  }
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.detail(id);
  }
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.properties.update(id, dto);
  }
  @Post(':id/remove')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.remove(id);
  }
  @Patch(':id/boundary')
  async boundary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BoundaryDto,
  ) {
    const ownerId = await this.properties.ownerId(id);
    return this.lifecycle.updateBoundary(ownerId, id, dto);
  }
  @Post(':id/images/presigned-url')
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageFileNamesDto,
  ) {
    const ownerId = await this.properties.ownerId(id);
    return this.images.createUploadUrls(ownerId, id, dto.fileNames);
  }
  @Post(':id/images/confirm')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageFileNamesDto,
  ) {
    const ownerId = await this.properties.ownerId(id);
    return this.images.confirmUploads(ownerId, id, dto.fileNames);
  }
  @Post(':id/images/remove')
  async removeImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageUrlsDto,
  ) {
    const ownerId = await this.properties.ownerId(id);
    return this.images.removeImages(ownerId, id, dto.urls);
  }
}
