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
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUserId } from '@tilomnov/shared';
import { BoundaryDto } from './dto/boundary.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreatePropertyDto } from './dto/create-property.dto';
import { FavoritesPageQuery } from './dto/favorites-page.query';
import { ImageFileNamesDto } from './dto/image-file-names.dto';
import { ImageUrlsDto } from './dto/image-urls.dto';
import { LeadDto } from './dto/lead.dto';
import { MapBoundsQuery } from './dto/map-bounds.query';
import { OwnListingsPageQuery } from './dto/own-listings-page.query';
import { PinDto } from './dto/pin.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { FavoriteListingsService } from './services/favorite-listings.service';
import { OwnerListingsService } from './services/owner-listings.service';
import { PropertyEngagementService } from './services/property-engagement.service';
import { PropertyImageService } from './services/property-image.service';
import { PropertyInsightsService } from './services/property-insights.service';
import { PropertyLifecycleService } from './services/property-lifecycle.service';
import { PropertyQueryService } from './services/property-query.service';
import { PublishingAllowanceService } from './services/publishing-allowance.service';

/** Authenticated property endpoints (the gateway has already verified the JWT). */
@ApiTags('properties')
@ApiHeader({ name: 'x-user-id', description: 'User ID from API Gateway' })
@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly query: PropertyQueryService,
    private readonly lifecycle: PropertyLifecycleService,
    private readonly images: PropertyImageService,
    private readonly engagement: PropertyEngagementService,
    private readonly favorites: FavoriteListingsService,
    private readonly owned: OwnerListingsService,
    private readonly insights: PropertyInsightsService,
    private readonly allowance: PublishingAllowanceService,
  ) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreatePropertyDto) {
    return this.lifecycle.create(userId, dto);
  }

  /**
   * The user's own listings, newest first. With `limit`: one page
   * `{ items, nextOffset, countByStatus }`, only of the statuses in `status`
   * when given (`Draft,Expired`); without: all of them, as an array.
   */
  @Get()
  findAll(
    @CurrentUserId() userId: string,
    @Query() page: OwnListingsPageQuery,
  ) {
    if (page.limit === undefined) return this.owned.all(userId);
    return this.owned.page(
      userId,
      { limit: page.limit, offset: page.offset ?? 0 },
      page.status,
    );
  }

  /** The user's own listings (drafts too) inside a map area, newest 500. */
  @Get('my/in-area')
  findOwnInArea(
    @CurrentUserId() userId: string,
    @Query() bounds: MapBoundsQuery,
  ) {
    return this.owned.inArea(userId, bounds);
  }

  /**
   * Saved listings. With `limit`: one page `{ items, nextOffset }` in `sort`
   * order (most recently saved first by default); without: all of them, as an
   * array, most recently saved first.
   */
  @Get('my/favorites')
  getFavorites(
    @CurrentUserId() userId: string,
    @Query() page: FavoritesPageQuery,
  ) {
    if (page.limit === undefined) return this.favorites.all(userId);
    return this.favorites.page(userId, {
      limit: page.limit,
      offset: page.offset ?? 0,
      sort: page.sort ?? 'saved',
    });
  }

  /** The ids of every saved listing: what the heart on each card shows. */
  @Get('my/favorites/ids')
  getFavoriteIds(@CurrentUserId() userId: string) {
    return this.favorites.ids(userId);
  }

  /** Plan usage excludes listings paid for separately. */
  @Get('my/publishing-usage')
  publishingUsage(@CurrentUserId() userId: string) {
    return this.allowance.usage(userId);
  }

  @Get(':id')
  findOne(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.query.findOwned(userId, id);
  }

  /**
   * How the caller's own listing is doing: totals and the last 14 days
   * (`PropertyInsights`). 404 for anyone else's.
   */
  @Get(':id/insights')
  getInsights(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.insights.of(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.lifecycle.update(userId, id, dto);
  }

  @Patch(':id/pin')
  updatePin(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PinDto,
  ) {
    return this.lifecycle.updatePin(userId, id, dto);
  }

  @Patch(':id/boundary')
  updateBoundary(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BoundaryDto,
  ) {
    return this.lifecycle.updateBoundary(userId, id, dto);
  }

  @Patch(':id/publish')
  publish(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.publish(userId, id);
  }

  @Patch(':id/unpublish')
  unpublish(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.unpublish(userId, id);
  }

  @Patch(':id/mark-sold')
  markSold(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.markSold(userId, id);
  }

  @Patch(':id/relist')
  relist(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.relist(userId, id);
  }

  @Delete(':id')
  remove(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.remove(userId, id);
  }

  @Post(':id/images/presigned-url')
  getPresignedUrls(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageFileNamesDto,
  ) {
    return this.images.createUploadUrls(userId, id, dto.fileNames);
  }

  @Post(':id/images/confirm')
  confirmUploadedImages(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageFileNamesDto,
  ) {
    return this.images.confirmUploads(userId, id, dto.fileNames);
  }

  @Post(':id/images/remove')
  removeImages(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImageUrlsDto,
  ) {
    return this.images.removeImages(userId, id, dto.urls);
  }

  @Post(':id/like')
  like(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.like(userId, id);
  }

  @Delete(':id/like')
  unlike(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.unlike(userId, id);
  }

  @Post(':id/favorite')
  favorite(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.favorite(userId, id);
  }

  @Delete(':id/favorite')
  unfavorite(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.unfavorite(userId, id);
  }

  @Post(':id/view')
  logView(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.logView(userId, id);
  }

  /** The caller tapped Call or Chat on a published listing: a lead for its owner. */
  @Post(':id/lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordLead(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeadDto,
  ): Promise<void> {
    await this.engagement.recordLead(userId, id, dto.channel);
  }

  @Post(':id/contact')
  contact(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.engagement.contact(userId, id, dto);
  }
}
