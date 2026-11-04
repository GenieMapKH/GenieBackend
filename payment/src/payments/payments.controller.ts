import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUserId, JwtAuthGuard } from '@tilomnov/shared';
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
  initiateCheckout(@CurrentUserId() userId: string, @Body() dto: CheckoutDto) {
    return this.checkout.initiate(
      userId,
      dto.propertyId,
      dto.method ?? 'aba_khqr',
    );
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
