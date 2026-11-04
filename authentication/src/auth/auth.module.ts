import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RedisConnection } from '../redis/redis-connection';
import { AccountController } from './account/account.controller';
import { AccountEmailService } from './account/account-email.service';
import { AccountService } from './account/account.service';
import { IdentityProofService } from './account/identity-proof.service';
import { PasswordProofService } from './account/password-proof.service';
import { UserContentClient } from './account/user-content.client';
import { AuthAttemptLimits } from './attempt-limiter';
import { AuthController } from './auth.controller';
import { CredentialsAuthService } from './credentials/credentials-auth.service';
import { JwtStrategy } from './jwt.strategy';
import { KnownLoginDevices } from './login-protection/known-login-devices.store';
import { LoginThrottle } from './login-protection/login-throttle.service';
import { EmailDeliveryService } from './mail/email-delivery.service';
import { OtpEmailService } from './mail/otp-email.service';
import { NotificationClient } from './notifications/notification.client';
import { PasswordResetOtpRepository } from './password-reset/password-reset-otp.repository';
import { PasswordResetService } from './password-reset/password-reset.service';
import { PhonePasswordResetService } from './password-reset/phone-password-reset.service';
import { EstablishedDeviceService } from './sessions/established-device.service';
import {
  IpLocationProvider,
  IpWhoIsLocationProvider,
} from './sessions/ip-location.provider';
import { RefreshTokenRepository } from './sessions/refresh-token.repository';
import { RevokedSessionStore } from './sessions/revoked-session.store';
import { SessionRevocationService } from './sessions/session-revocation.service';
import { SessionService } from './sessions/session.service';
import { SessionsController } from './sessions/sessions.controller';
import { SignInService } from './sessions/sign-in.service';
import { TokenIssuerService } from './sessions/token-issuer.service';
import { FirebaseLoginService } from './social/firebase-login.service';
import { UserRepository } from './users/user.repository';

@Module({
  imports: [
    JwtModule.register({
      privateKey: process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      publicKey: process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n'),
      signOptions: { algorithm: 'RS256' },
      verifyOptions: { algorithms: ['RS256'] },
    }),
  ],
  controllers: [AuthController, SessionsController, AccountController],
  providers: [
    RedisConnection,
    AuthAttemptLimits,
    KnownLoginDevices,
    LoginThrottle,
    RevokedSessionStore,
    JwtStrategy,
    UserRepository,
    RefreshTokenRepository,
    PasswordResetOtpRepository,
    { provide: IpLocationProvider, useClass: IpWhoIsLocationProvider },
    TokenIssuerService,
    SessionRevocationService,
    EstablishedDeviceService,
    SessionService,
    IdentityProofService,
    PasswordProofService,
    UserContentClient,
    AccountService,
    AccountEmailService,
    SignInService,
    CredentialsAuthService,
    FirebaseLoginService,
    PasswordResetService,
    PhonePasswordResetService,
    EmailDeliveryService,
    OtpEmailService,
    NotificationClient,
  ],
})
export class AuthModule {}
