import { Module } from '@nestjs/common';
import { SupabaseModule } from '@tilomnov/shared';
import { InternalAccountsController } from './internal/internal-accounts.controller';
import { InternalPublicationController } from './internal/internal-publication.controller';
import {
  GoogleNearbyPlaceProvider,
  GoogleRouteDistanceProvider,
  GoogleRoutePathProvider,
} from './nearby/google-nearby.providers';
import {
  NearbyPlaceProvider,
  RouteDistanceProvider,
  RoutePathProvider,
} from './nearby/nearby-providers';
import { NearbyRouteController } from './nearby/nearby-route.controller';
import { NearbyRouteService } from './nearby/nearby-route.service';
import { PropertyNearbyService } from './nearby/property-nearby.service';
import { PropertiesController } from './properties.controller';
import { PropertyStatusService } from './property-status.service';
import { PublicPropertiesController } from './public-properties.controller';
import { FavoriteListingsService } from './services/favorite-listings.service';
import { GuestSessionService } from './services/guest-session.service';
import { ListingChanges } from './services/listing-changes.service';
import { OwnerListingsService } from './services/owner-listings.service';
import { PropertyEngagementCounts } from './services/property-engagement-counts.service';
import { PropertyEngagementService } from './services/property-engagement.service';
import { PropertyImageService } from './services/property-image.service';
import { PropertyInsightsService } from './services/property-insights.service';
import { PropertyLifecycleService } from './services/property-lifecycle.service';
import { PropertyPublicationService } from './services/property-publication.service';
import { ClosestListingsService } from './services/closest-listings.service';
import { PropertyQueryService } from './services/property-query.service';
import { PropertyThumbnailService } from './services/property-thumbnail.service';
import { PropertySearchService } from './services/property-search.service';
import { PublicPropertyCache } from './services/public-property-cache.service';
import { PropertyPhotoStorage } from './storage/property-photo-storage';
import { PublishingAllowanceService } from './services/publishing-allowance.service';

@Module({
  imports: [SupabaseModule],
  controllers: [
    PropertiesController,
    PublicPropertiesController,
    NearbyRouteController,
    InternalPublicationController,
    InternalAccountsController,
  ],
  providers: [
    PublishingAllowanceService,
    PropertyStatusService,
    PublicPropertyCache,
    ListingChanges,
    PropertyEngagementCounts,
    PropertyQueryService,
    FavoriteListingsService,
    OwnerListingsService,
    PropertySearchService,
    ClosestListingsService,
    PropertyLifecycleService,
    PropertyPublicationService,
    PropertyPhotoStorage,
    PropertyThumbnailService,
    PropertyImageService,
    PropertyInsightsService,
    PropertyEngagementService,
    GuestSessionService,
    PropertyNearbyService,
    NearbyRouteService,
    { provide: RoutePathProvider, useClass: GoogleRoutePathProvider },
    { provide: NearbyPlaceProvider, useClass: GoogleNearbyPlaceProvider },
    { provide: RouteDistanceProvider, useClass: GoogleRouteDistanceProvider },
  ],
  // Search reads listings through these services, caches what it finds
  // with the public listings, and keeps its index current by listening to
  // every listing change.
  exports: [
    PropertyQueryService,
    PropertySearchService,
    PublicPropertyCache,
    ListingChanges,
  ],
})
export class PropertiesModule {}
