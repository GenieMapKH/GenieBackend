import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { PromotionSender } from './promotion-sender';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** What the admin sees about a promotion: where its sending is. */
export interface PromotionStatus {
  id: string;
  status: string;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const STATUS_FIELDS = {
  id: true,
  status: true,
  sentCount: true,
  failedCount: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

/** Records a promotion and has it sent in the background. */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PromotionSender,
  ) {}

  /**
   * Queues [dto] and starts sending it. Repeating a request with the same id
   * returns the first one's status instead of sending it again.
   */
  async create(
    adminId: string,
    dto: CreatePromotionDto,
  ): Promise<PromotionStatus> {
    let promotion: PromotionStatus;
    try {
      promotion = await this.prisma.promotion.create({
        data: {
          id: dto.id,
          createdBy: adminId,
          title: dto.title,
          body: dto.body,
          titleKm: dto.titleKm,
          bodyKm: dto.bodyKm,
          propertyId: dto.propertyId,
          url: dto.url,
          imageUrl: dto.imageUrl,
        },
        select: STATUS_FIELDS,
      });
    } catch (error) {
      if (
        !dto.id ||
        (error as { code?: string }).code !== UNIQUE_CONSTRAINT_VIOLATION
      )
        throw error;
      return this.statusOfRepeat(adminId, dto.id);
    }

    this.sender.startInBackground(promotion.id);
    return promotion;
  }

  async status(id: string): Promise<PromotionStatus> {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      select: STATUS_FIELDS,
    });
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }

  /** Only the admin who sent it may repeat a request: an id is not a password. */
  private async statusOfRepeat(
    adminId: string,
    id: string,
  ): Promise<PromotionStatus> {
    const existing = await this.prisma.promotion.findUnique({
      where: { id },
      select: { ...STATUS_FIELDS, createdBy: true },
    });
    if (!existing || existing.createdBy !== adminId) {
      throw new ConflictException('Promotion id is already in use');
    }
    const { createdBy: _createdBy, ...status } = existing;
    return status;
  }
}
