import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PaymentProvider } from './payment-provider.interface';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentWebhookDto } from './dto/payment.dto';

/** A callback triggers provider verification; its claimed status never grants benefits. */
@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly gateway: PaymentGatewayService,
  ) {}

  async handle(dto: PaymentWebhookDto, signature: string) {
    if (!this.provider.verifyWebhook(dto, signature))
      throw new UnauthorizedException('Invalid webhook signature');
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { id: dto.transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.provider !== this.provider.name)
      throw new BadRequestException('Wrong payment provider');
    if (dto.amount !== undefined && !transaction.amount.equals(dto.amount))
      throw new BadRequestException('Amount does not match the transaction');
    const result = await this.gateway.reconcile(transaction.id);
    return {
      success: result.status === 'Success',
      ...(transaction.status !== 'Pending' && { alreadyProcessed: true }),
    };
  }
}
