import { Test } from '@nestjs/testing';
import { HealthController } from '@tilomnov/shared';
import { AppModule } from './app.module';
import { FollowsController } from './follows/follows.controller';
import { InternalFollowsController } from './follows/internal-follows.controller';
import { InternalAccountsController } from './users/internal-accounts.controller';
import { UsersController } from './users/users.controller';

// Nest only reports a missing provider at boot time, so resolve the whole
// service here. Nothing connects: the DB pool, Redis and Supabase client are lazy.
describe('user service wiring', () => {
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
      UsersController,
      InternalAccountsController,
      FollowsController,
      InternalFollowsController,
      HealthController,
    ]) {
      expect(moduleRef.get(type)).toBeDefined();
    }

    await moduleRef.close();
  });
});
