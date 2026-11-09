import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, CurrentUserId } from '@tilomnov/shared';
import { AdminPlatformService } from './admin-platform.service';
import { ModerationReasonDto } from './admin-moderation.dto';

@UseGuards(AdminGuard)
@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(private readonly platform: AdminPlatformService) {}
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.property('GET', `properties/${id}`);
  }
  @Patch(':id')
  update(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platform.mutate(
      actor,
      id,
      'property.edit',
      'Listing details edited',
      () => this.platform.property('PATCH', `properties/${id}`, body),
    );
  }
  @Post(':id/remove')
  remove(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationReasonDto,
  ) {
    return this.platform.mutate(actor, id, 'property.remove', dto.reason, () =>
      this.platform.property('POST', `properties/${id}/remove`),
    );
  }
  @Patch(':id/boundary')
  boundary(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platform.mutate(
      actor,
      id,
      'property.boundary',
      'Listing boundary edited',
      () => this.platform.property('PATCH', `properties/${id}/boundary`, body),
    );
  }
  @Post(':id/images/presigned-url')
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platform.property(
      'POST',
      `properties/${id}/images/presigned-url`,
      body,
    );
  }
  @Post(':id/images/confirm')
  confirm(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platform.mutate(
      actor,
      id,
      'property.photos',
      'Listing photos added',
      () =>
        this.platform.property('POST', `properties/${id}/images/confirm`, body),
    );
  }
  @Post(':id/images/remove')
  images(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.platform.mutate(
      actor,
      id,
      'property.photos',
      'Listing photos removed',
      () =>
        this.platform.property('POST', `properties/${id}/images/remove`, body),
    );
  }
}

@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminAccountActionsController {
  constructor(private readonly platform: AdminPlatformService) {}
  @Post(':id/ban')
  ban(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationReasonDto,
  ) {
    return this.platform.account(actor, id, 'ban', dto.reason);
  }
  @Delete(':id')
  remove(
    @CurrentUserId() actor: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationReasonDto,
  ) {
    return this.platform.account(actor, id, 'delete', dto.reason);
  }
}
