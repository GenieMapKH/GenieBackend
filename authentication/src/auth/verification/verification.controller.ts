import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { Client, ClientContext } from '../sessions/client-context';
import { EmailVerificationService } from './email-verification.service';

@Controller('auth/verification/email')
export class VerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('request')
  @HttpCode(200)
  async request(
    @Body() dto: ForgotPasswordDto,
    @Client() client: ClientContext,
  ) {
    await this.verification.request(dto.email, client.ipAddress);
    return { message: 'Verification code sent' };
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(@Body() dto: VerifyOtpDto) {
    return this.verification.confirm(dto.email, dto.otp);
  }
}
