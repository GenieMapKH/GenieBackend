import { IsIn, IsNumber, IsOptional, IsUUID } from 'class-validator';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from '../payment-provider.interface';
import { PaidTier } from '../plan-catalog';

export class CheckoutDto {
  @IsUUID()
  requestId: string;

  @IsUUID()
  propertyId: string;

  /** How the user pays; KHQR when not said (any banking app can pay it). */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;
}

export class SubscriptionCheckoutDto {
  @IsUUID()
  requestId: string;

  @IsIn(['silver', 'gold', 'diamond'])
  tier: PaidTier;

  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;
}

export class PaymentWebhookDto {
  @IsUUID()
  transactionId: string;

  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  /** When present it must equal the amount we asked the user to pay. */
  @IsOptional()
  @IsNumber()
  amount?: number;
}
