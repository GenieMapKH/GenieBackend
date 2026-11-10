import {
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService, serviceCallGuard } from '@tilomnov/shared';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { EmailDeliveryService } from './email-delivery.service';

export class OrderEmailDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  transactionId!: string;

  @IsIn(['silver', 'gold', 'diamond', 'listing_publish'])
  item!: 'silver' | 'gold' | 'diamond' | 'listing_publish';

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amount!: number;

  @IsISO8601()
  periodStart!: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;
}

@ApiExcludeController()
@UseGuards(serviceCallGuard('payment'))
@Controller({ path: 'internal/mail/order', version: VERSION_NEUTRAL })
export class OrderEmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: EmailDeliveryService,
  ) {}

  @Post()
  async send(@Body() dto: OrderEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { email: true },
    });
    if (!user?.email) return { sent: false };

    const item = {
      silver: 'Silver subscription',
      gold: 'Gold subscription',
      diamond: 'Diamond subscription',
      listing_publish: 'One-time listing publication (one month)',
    }[dto.item];
    const sent = await this.delivery.deliver({
      to: user.email,
      subject: `Tilomnov order confirmation #${dto.transactionId}`,
      html: `<h1>Order confirmed</h1>
<p>${item}</p>
<p>Order total: USD ${dto.amount.toFixed(2)} (tax included)</p>
<p>Transaction ID: ${dto.transactionId}</p>
<p>Confirmed (UTC): ${new Date(dto.periodStart).toISOString()}</p>
${dto.periodEnd ? `<p>Access until (UTC): ${new Date(dto.periodEnd).toISOString()}</p>` : ''}`,
    });
    if (!sent) {
      throw new ServiceUnavailableException('Order email was not sent');
    }
    return { sent: true };
  }
}
