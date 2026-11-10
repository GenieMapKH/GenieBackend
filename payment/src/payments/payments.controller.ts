import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, JwtAuthGuard } from '@tilomnov/shared';
import { CheckoutDto, PaymentWebhookDto } from './dto/payment.dto';
import { PaymentCheckoutService } from './payment-checkout.service';
import { PaymentWebhookService } from './payment-webhook.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly checkout: PaymentCheckoutService,
    private readonly webhook: PaymentWebhookService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  initiateCheckout(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CheckoutDto,
  ) {
    return this.checkout.initiate(
      request.user.userId,
      dto.propertyId,
      dto.requestId,
      dto.method,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('transactions/:id')
  state(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.checkout.state(request.user.userId, id);
  }

  /** Called by the payment provider, not by users. Authenticated by signature. */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Headers('x-signature') signature: string | undefined,
    @Body() dto: PaymentWebhookDto,
  ) {
    return this.webhook.handle(dto, signature ?? '');
  }
}
