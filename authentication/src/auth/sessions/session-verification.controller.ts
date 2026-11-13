import {
  Controller,
  Get,
  HttpCode,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/** Private network endpoint; proves possession of the actual access token, not identity headers. */
@Controller({ path: 'internal/sessions', version: VERSION_NEUTRAL })
export class SessionVerificationController {
  @Get('verify')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  verify(): void {}
}
