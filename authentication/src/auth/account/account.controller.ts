import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthAttemptLimits } from '../attempt-limiter';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { AddEmailDto } from '../dto/add-email.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { IdentityProofDto } from '../dto/identity-proof.dto';
import { CreatePasswordDto, PasswordProofDto } from '../dto/password.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AccountEmailService } from './account-email.service';
import { AccountService } from './account.service';
import { PasswordProofService } from './password-proof.service';
import { AccountPhoneService } from './account-phone.service';
import { ChangePhoneDto } from '../dto/change-phone.dto';
import { VerifyPhoneDto } from '../dto/verify-phone.dto';

/** Account security for the signed-in user: password, email, deactivate, delete. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth')
@ApiResponse({
  status: 403,
  description:
    'The password (or Google confirmation) is wrong, or `code: DEVICE_TOO_NEW`: signed in less than a day ago',
})
@ApiResponse({ status: 429, description: 'Too many wrong tries' })
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(AccountEmailService)
    private readonly accountEmail: AccountEmailService,
    @Inject(PasswordProofService)
    private readonly passwordProofs: PasswordProofService,
    @Inject(AuthAttemptLimits) private readonly limits: AuthAttemptLimits,
    private readonly accountPhone: AccountPhoneService,
  ) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password; every other device is signed out',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.account.changePassword(user, dto.currentPassword, dto.newPassword),
    );
    return { message: 'Password changed' };
  }

  @Post('account/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Give a Google account a password of its own, confirmed with Google',
  })
  async createPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePasswordDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.account.createPassword(user, dto.idToken, dto.newPassword),
    );
    return { message: 'Password created' };
  }

  @Post('account/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Add an email to an account that has none, confirmed with the password',
  })
  @ApiResponse({
    status: 409,
    description: 'The account already has an email, or another account uses it',
  })
  async addEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddEmailDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.accountEmail.addEmail(user, dto.email, dto.password, dto.emailProof),
    );
    return { message: 'Email added' };
  }

  @Post('account/phone/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyPhoneDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.accountPhone.verify(user, dto.phone, dto.phoneProof),
    );
    return { message: 'Phone number verified' };
  }

  @Post('account/phone')
  @HttpCode(HttpStatus.OK)
  async changePhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePhoneDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.accountPhone.change(user, dto.phone, dto),
    );
    return { message: 'Phone number saved' };
  }

  @Post('account/password-proof')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'A 5-minute token proving the password, for recovering a forgotten chat PIN',
  })
  proveWithPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PasswordProofDto,
  ) {
    return this.withLimitedTries(user.userId, () =>
      this.passwordProofs.issue(user.userId, dto.password),
    );
  }

  @Post('account/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide the account until its owner signs in again' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IdentityProofDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.account.deactivate(user, dto),
    );
    return { message: 'Account deactivated' };
  }

  @Post('account/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete the account and everything that belongs to it, for good',
  })
  @ApiResponse({
    status: 503,
    description: 'Its files could not be removed; nothing was deleted',
  })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IdentityProofDto,
  ) {
    await this.withLimitedTries(user.userId, () =>
      this.account.delete(user, dto),
    );
    return { message: 'Account deleted' };
  }

  /** Wrong passwords are counted per account, so a signed-in thief cannot guess theirs here. */
  private async withLimitedTries<T>(
    userId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    await this.limits.identityProof.consumeOrReject(userId);
    const result = await action();
    // Only failures count: a right answer clears the slate.
    await this.limits.identityProof.reset(userId);
    return result;
  }
}
