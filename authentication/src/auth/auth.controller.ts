import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminLoginService } from './admin-login.service';
import { AdminLoginCompleteDto } from './dto/admin-login.dto';
import { AuthAttemptLimits } from './attempt-limiter';
import { CredentialsAuthService } from './credentials/credentials-auth.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  DEVICE_KEY_HEADER,
  readDeviceKey,
} from './login-protection/device-key';
import { LoginThrottle } from './login-protection/login-throttle.service';
import { PasswordResetService } from './password-reset/password-reset.service';
import { Client, ClientContext } from './sessions/client-context';
import { SessionService } from './sessions/session.service';
import { FirebaseLoginService } from './social/firebase-login.service';

/**
 * Signing in and out, and password reset by email: everything a caller does
 * without an access token. HTTP layer only: every handler validates input
 * (via DTOs) and delegates.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CredentialsAuthService)
    private readonly credentials: CredentialsAuthService,
    @Inject(FirebaseLoginService)
    private readonly firebaseLogin: FirebaseLoginService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordResetService)
    private readonly passwordReset: PasswordResetService,
    @Inject(AuthAttemptLimits) private readonly limits: AuthAttemptLimits,
    @Inject(LoginThrottle) private readonly loginThrottle: LoginThrottle,
    private readonly adminLogin: AdminLoginService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email or phone already exists' })
  @ApiResponse({
    status: 429,
    description: 'Too many new accounts from this network',
  })
  async register(@Body() dto: RegisterDto, @Client() client: ClientContext) {
    // Only accounts actually made count: a refused sign-up is given back.
    const network = client.ipAddress ?? 'unknown';
    await this.limits.registrationsPerNetwork.consumeOrReject(
      network,
      'in an hour',
    );
    try {
      await this.credentials.register(dto);
    } catch (error) {
      await this.limits.registrationsPerNetwork.refund(network);
      throw error;
    }
    return { message: 'User registered successfully' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with credentials (email/phone + password)' })
  @ApiResponse({
    status: 200,
    description:
      'Returns tokens for users; admins receive status admin_email_required without session tokens',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({
    status: 429,
    description:
      'Too many wrong passwords from this network or device, or `code: ACCOUNT_UNDER_ATTACK`: only devices that signed in to the account before may try now',
  })
  login(
    @Body() dto: LoginDto,
    @Client() client: ClientContext,
    @Headers(DEVICE_KEY_HEADER) deviceKey: string | undefined,
  ) {
    return this.loginThrottle.guard(
      {
        account: accountKey(dto.email ?? dto.phone),
        ipAddress: client.ipAddress,
        deviceKey: readDeviceKey(deviceKey),
      },
      () => this.credentials.login(dto, client),
    );
  }

  @Post('admin-login/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a single-use admin email link for session tokens',
  })
  completeAdminLogin(
    @Body() dto: AdminLoginCompleteDto,
    @Client() client: ClientContext,
  ) {
    return this.adminLogin.complete(dto.token, client);
  }

  @Post('firebase-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in or register using a Firebase ID token' })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged in, returns tokens',
  })
  @ApiResponse({ status: 401, description: 'Invalid Firebase token' })
  loginWithFirebase(
    @Body() dto: FirebaseLoginDto,
    @Client() client: ClientContext,
  ) {
    return this.firebaseLogin.login(dto.idToken, client);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens successfully rotated' })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or revoked refresh token',
  })
  refresh(@Body() dto: RefreshDto, @Client() client: ClientContext) {
    return this.sessions.refresh(dto.refreshToken, client);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a specific refresh token (single device logout)',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  logout(@Body() dto: LogoutDto) {
    return this.sessions.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset OTP via email' })
  @ApiResponse({ status: 200, description: 'OTP sent if email exists' })
  @ApiResponse({
    status: 429,
    description: 'Too many reset requests for this address or from this caller',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Client() client: ClientContext,
  ) {
    await this.countResetRequest(dto.email, client.ipAddress);
    return this.passwordReset.requestReset(dto.email);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a password reset OTP' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.countOtpAttempt(dto.email);
    return this.passwordReset.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a verified OTP' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.countOtpAttempt(dto.email);
    return this.passwordReset.resetPassword(
      dto.email,
      dto.otp,
      dto.newPassword,
    );
  }

  /**
   * Counted before the account is looked up, so the limits answer the same
   * for unknown addresses and do not reveal which ones exist. The caller is
   * counted first: a refused flood does not use up a victim's own allowance.
   */
  private async countResetRequest(
    email: string,
    clientIp: string | null,
  ): Promise<void> {
    if (clientIp)
      await this.limits.resetRequestsPerClient.consumeOrReject(
        clientIp,
        'in an hour',
      );
    const account = accountKey(email);
    await this.limits.resetCooldown.consumeOrReject(account, 'in a minute');
    await this.limits.resetRequests.consumeOrReject(account);
    await this.limits.resetRequestsPerDay.consumeOrReject(account, 'tomorrow');
  }

  private async countOtpAttempt(email: string): Promise<void> {
    const account = accountKey(email);
    await this.limits.otp.consumeOrReject(account);
    await this.limits.otpPerDay.consumeOrReject(account, 'tomorrow');
  }
}

/** The same account whatever the capitalisation or spacing it was typed with. */
function accountKey(identifier: string | undefined): string {
  return (identifier ?? '').trim().toLowerCase();
}
