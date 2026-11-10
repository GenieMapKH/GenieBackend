import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  JwtAuthGuard,
  serviceCallGuard,
} from '@tilomnov/shared';
import {
  SubscriptionCheckoutDto,
  SubscriptionQuoteParams,
} from './dto/payment.dto';
import { SubscriptionService } from './subscription.service';

@UseGuards(JwtAuthGuard)
@Controller('payments/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('current')
  async current(@Req() request: { user: AuthenticatedUser }) {
    return {
      subscription: await this.subscriptions.current(request.user.userId),
    };
  }

  @Post('checkout')
  checkout(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: SubscriptionCheckoutDto,
  ) {
    return this.subscriptions.purchase(
      request.user.userId,
      dto.tier,
      dto.requestId,
      dto.method,
      dto.quote,
    );
  }

  @Get('expired')
  async expired(@Req() request: { user: AuthenticatedUser }) {
    return {
      subscription: await this.subscriptions.expired(request.user.userId),
    };
  }

  @Get('quote/:tier')
  quote(
    @Req() request: { user: AuthenticatedUser },
    @Param() params: SubscriptionQuoteParams,
  ) {
    return this.subscriptions.quote(request.user.userId, params.tier);
  }

  @Post('cancel')
  async cancel(@Req() request: { user: AuthenticatedUser }) {
    return {
      subscription: await this.subscriptions.cancel(request.user.userId),
    };
  }
}

@ApiExcludeController()
@UseGuards(serviceCallGuard('property'))
@Controller({ path: 'internal/subscriptions', version: VERSION_NEUTRAL })
export class InternalSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get(':userId/allowance')
  allowance(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.subscriptions.allowance(userId);
  }

  @Get(':userId/publishing')
  publishing(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.subscriptions.publishingEntitlements(userId);
  }
}
