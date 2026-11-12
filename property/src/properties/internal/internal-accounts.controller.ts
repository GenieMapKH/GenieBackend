import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MessageBus, PrismaService, serviceCallGuard } from '@tilomnov/shared';
import { IsUUID } from 'class-validator';
import { PropertyImageService } from '../services/property-image.service';
import { ListingChanges } from '../services/listing-changes.service';
import { CACHED_LISTING_SELECT } from '../services/public-property-cache.service';

export class AccountVisibilityEvent {
  @IsUUID() userId: string;
}

/**
 * What the property service keeps for an account, acted on when the user
 * service says the account was hidden, restored or deleted. Called by that
 * service only, never by the app.
 */
@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/accounts/:userId', version: VERSION_NEUTRAL })
export class InternalAccountsController implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: PropertyImageService,
    private readonly listingChanges: ListingChanges,
    @Optional() private readonly messages?: MessageBus,
  ) {}

  onModuleInit(): void {
    this.messages?.handleValidated(
      'property.account-visibility.v1',
      AccountVisibilityEvent,
      (event) => this.visibilityChanged(event.userId),
    );
  }

  /** The account is being deleted: remove the photos of its listings. */
  @Delete('files')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eraseFiles(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.images.removeAllOwnedBy(userId);
  }

  /**
   * What others see of the account changed (name, picture, hidden or shown):
   * its published listings carry the owner's name and picture, so they are
   * dropped from the cache and read again, and searched for anew (a hidden
   * owner's listings, and the owner, leave the search index).
   */
  @Post('visibility-changed')
  @HttpCode(HttpStatus.NO_CONTENT)
  async visibilityChanged(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    const listings = await this.prisma.property.findMany({
      where: { userId, status: 'Active' },
      select: CACHED_LISTING_SELECT,
    });
    await Promise.all(
      listings.map((listing) => this.listingChanges.changed(listing)),
    );
  }
}
