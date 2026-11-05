import { Test } from '@nestjs/testing';
import { HealthController } from '@tilomnov/shared';
import { AppModule } from './app.module';
import { FeedController } from './feed/feed.controller';
import { InternalAccountsController } from './properties/internal/internal-accounts.controller';
import { InternalPublicationController } from './properties/internal/internal-publication.controller';
import { PropertiesController } from './properties/properties.controller';
import { PublicPropertiesController } from './properties/public-properties.controller';
import { SearchHistoryController } from './search/history/search-history.controller';
import { SearchController } from './search/search.controller';

// Nest only reports a missing provider at boot time, so resolve the whole
// service here. Nothing connects: the DB pool, Redis and Supabase client are lazy.
describe('property service wiring', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('resolves every controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    for (const type of [
      PropertiesController,
      PublicPropertiesController,
      SearchController,
      SearchHistoryController,
      FeedController,
      InternalPublicationController,
      InternalAccountsController,
      HealthController,
    ]) {
      expect(moduleRef.get(type)).toBeDefined();
    }

    await moduleRef.close();
  });
});
