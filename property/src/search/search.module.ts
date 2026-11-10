import { Module } from '@nestjs/common';
import { ListingNotificationsModule } from '../notifications/listing-notifications.module';
import { PropertiesModule } from '../properties/properties.module';
import { SearchHistoryController } from './history/search-history.controller';
import { SearchHistoryService } from './history/search-history.service';
import { MeilisearchEngine } from './index/meilisearch.engine';
import { SearchEngine } from './index/search-engine';
import { SearchIndexSync } from './index/search-index-sync.service';
import { SearchReindexSchedule } from './index/search-reindex.schedule';
import { GooglePlacesProvider } from './places/google-places.provider';
import { PlaceProvider } from './places/place-provider';
import { PeopleSearchService } from './people-search.service';
import { SavedSearchMatcher } from './saved/saved-search-matcher';
import { SavedSearchesController } from './saved/saved-searches.controller';
import { SavedSearchesService } from './saved/saved-searches.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { TextSearchService } from './text-search.service';

/**
 * The home screen's search bar. Places come from the map provider, listings
 * and the people who post them from the property data, ranked by the search
 * engine (kept in step with every listing change) when one is configured. It
 * owns the user's search history and saved searches, which alert when a new
 * listing matches.
 */
@Module({
  imports: [PropertiesModule, ListingNotificationsModule],
  controllers: [
    SearchController,
    SearchHistoryController,
    SavedSearchesController,
  ],
  providers: [
    SearchService,
    PeopleSearchService,
    SearchHistoryService,
    SavedSearchesService,
    SavedSearchMatcher,
    TextSearchService,
    SearchIndexSync,
    SearchReindexSchedule,
    { provide: PlaceProvider, useClass: GooglePlacesProvider },
    {
      provide: SearchEngine,
      useFactory: () => MeilisearchEngine.fromEnvironment(),
    },
  ],
})
export class SearchModule {}
