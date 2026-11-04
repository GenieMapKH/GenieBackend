import { Module } from '@nestjs/common';
import { PrismaModule } from '@tilomnov/shared';
import { SentryErrorsModule } from '@tilomnov/shared/sentry';
import { AuthModule } from './auth/auth.module';
import { FirebaseModule } from './firebase/firebase.module';

@Module({
  imports: [SentryErrorsModule, PrismaModule, FirebaseModule, AuthModule],
})
export class AppModule {}
