import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { serviceCallGuard } from '@tilomnov/shared';
import { AccountService } from './account.service';

@ApiExcludeController()
@UseGuards(serviceCallGuard('user'))
@Controller({ path: 'internal/admin/accounts', version: VERSION_NEUTRAL })
export class AdminAccountsController {
  constructor(private readonly accounts: AccountService) {}
  @Post(':id/ban')
  @HttpCode(204)
  ban(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.adminBan(id);
  }
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.adminDelete(id);
  }
}
