import { Module } from '@nestjs/common';
import { RedisConnection } from '../redis/redis-connection';
import { AccountController } from './account/account.controller';
import { AccountEmailService } from './account/account-email.service';
import { AccountService } from './account/account.service';
import { IdentityProofService } from './account/identity-proof.service';
import { PasswordProofService } from './account/password-proof.service';
import { UserContentClient } from './account/user-content.client';
import { AuthAttemptLimits } from './attempt-limiter';
import { AdminLoginService } from './admin-login.service';
import { AuthController } from './auth.controller';
import { CredentialsAuthService } from './credentials/credentials-auth.service';
import { JwtStrategy } from './jwt.strategy';
import { KnownLoginDevices } from './login-protection/known-login-devices.store';
import { LoginThrottle } from './login-protection/login-throttle.service';
import { EmailDeliveryService } from './mail/email-delivery.service';
import { OtpEmailService } from './mail/otp-email.service';
import { OrderEmailController } from './mail/order-email.controller';
import { NotificationClient } from './notifications/notification.client';
import { PasswordResetOtpRepository } from './password-reset/password-reset-otp.repository';
import { PasswordResetService } from './password-reset/password-reset.service';
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
import { JwksController } from './signing-keys/jwks.controller';
import { SigningKeyRotationService } from './signing-keys/signing-key-rotation.service';
import { SigningKeyRepository } from './signing-keys/signing-key.repository';
import { SigningKeyStore } from './signing-keys/signing-key.store';
import { TokenSigner } from './signing-keys/token-signer.service';
import { FirebaseLoginService } from './social/firebase-login.service';
import { UserRepository } from './users/user.repository';
import { EmailVerificationService } from './verification/email-verification.service';
import { VerificationController } from './verification/verification.controller';
import { AccountPhoneService } from './account/account-phone.service';
import { AdminAccountsController } from './account/admin-accounts.controller';

@Module({
  controllers: [
    AdminAccountsController,
    AuthController,
    SessionsController,
    AccountController,
    JwksController,
    OrderEmailController,
    VerificationController,
  ],
  providers: [
    EmailVerificationService,
    AccountPhoneService,
    SigningKeyRepository,
    SigningKeyStore,
    SigningKeyRotationService,
    TokenSigner,
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
    AdminLoginService,
    FirebaseLoginService,
    PasswordResetService,
    EmailDeliveryService,
    OtpEmailService,
    NotificationClient,
  ],
})
export class AuthModule {}
