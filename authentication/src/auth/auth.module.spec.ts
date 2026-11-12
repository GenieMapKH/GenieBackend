import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { AccountController } from './account/account.controller';
import { AuthController } from './auth.controller';
import { AuthModule } from './auth.module';
import { SessionsController } from './sessions/sessions.controller';
import { JwksController } from './signing-keys/jwks.controller';
import { MessageBus, PrismaService } from '@tilomnov/shared';
import { FirebaseService } from '../firebase/firebase.service';

// firebase-admin pulls in ESM-only packages Jest cannot load.
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: MessageBus,
      useValue: { enabled: false, handleValidated: jest.fn() },
    },
    { provide: FirebaseService, useValue: {} },
  ],
  exports: [PrismaService, FirebaseService, MessageBus],
})
class FakeInfrastructureModule {}

describe('AuthModule wiring', () => {
  beforeAll(() => {
    process.env.JWT_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('resolves every dependency of the controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeInfrastructureModule, AuthModule],
    }).compile();

    expect(moduleRef.get(AuthController)).toBeDefined();
    expect(moduleRef.get(SessionsController)).toBeDefined();
    expect(moduleRef.get(AccountController)).toBeDefined();
    expect(moduleRef.get(JwksController)).toBeDefined();
  });
});
