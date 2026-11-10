import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, RateLimit, RateLimits } from '@tilomnov/shared';
import { CreateContactDto } from '../dto/create-contact.dto';
import { LeadChannel } from '../dto/lead.dto';
import { PUBLISHED } from '../property-includes';

/** Messages to listing owners one account may send: 10 every 10 minutes. */
const CONTACT_LIMIT = 10;
const CONTACT_WINDOW_SECONDS = 10 * 60;

/** What users do with someone else's listing: like, favorite, view, contact, call or chat. */
@Injectable()
export class PropertyEngagementService {
  private readonly contactLimiter: RateLimit;

  constructor(
    private readonly prisma: PrismaService,
    rateLimits: RateLimits,
  ) {
    this.contactLimiter = rateLimits.create(
      'property-contact',
      CONTACT_LIMIT,
      CONTACT_WINDOW_SECONDS,
    );
  }

  /**
   * Liking, saving and viewing again changes nothing. Each is one
   * `INSERT ... ON CONFLICT DO NOTHING`: an upsert costs a transaction of
   * four statements.
   */
  async like(userId: string, propertyId: string) {
    await this.assertVisible(propertyId);
    const key = { userId, propertyId };
    await this.prisma.propertyLike.createMany({
      data: [key],
      skipDuplicates: true,
    });
    return this.prisma.propertyLike.findUniqueOrThrow({
      where: { userId_propertyId: key },
    });
  }

  async unlike(userId: string, propertyId: string) {
    await this.prisma.propertyLike.deleteMany({
      where: { userId, propertyId },
    });
    return { success: true };
  }

  async favorite(userId: string, propertyId: string) {
    await this.assertVisible(propertyId);
    const key = { userId, propertyId };
    await this.prisma.propertyFavorite.createMany({
      data: [key],
      skipDuplicates: true,
    });
    return this.prisma.propertyFavorite.findUniqueOrThrow({
      where: { userId_propertyId: key },
    });
  }

  async unfavorite(userId: string, propertyId: string) {
    await this.prisma.propertyFavorite.deleteMany({
      where: { userId, propertyId },
    });
    return { success: true };
  }

  /**
   * One row per person per listing, so the view count is how many people
   * opened it. The owner opening their own listing is not a view.
   */
  async logView(userId: string, propertyId: string) {
    const ownerId = await this.visibleOwnerId(propertyId);
    if (ownerId === userId) return { success: true };
    await this.prisma.propertyView.createMany({
      data: [{ userId, propertyId }],
      skipDuplicates: true,
    });
    return { success: true };
  }

  /**
   * The buyer tapped Call or Chat on the listing: one lead per person and
   * channel, so tapping again counts nothing more. Counted only when the
   * listing is published, and never for its owner. Limited like messages to
   * owners, since each is one more row.
   */
  async recordLead(userId: string, propertyId: string, channel: LeadChannel) {
    const ownerId = await this.visibleOwnerId(propertyId);
    if (ownerId === userId) return { success: true };
    await this.consumeContactAllowance(userId);
    await this.prisma.propertyLead.createMany({
      data: [{ propertyId, userId, channel }],
      skipDuplicates: true,
    });
    return { success: true };
  }

  async contact(userId: string, propertyId: string, dto: CreateContactDto) {
    await this.assertVisible(propertyId);
    await this.consumeContactAllowance(userId);
    return this.prisma.propertyContact.create({
      data: { ...dto, propertyId, userId },
    });
  }

  private async consumeContactAllowance(userId: string): Promise<void> {
    try {
      await this.contactLimiter.consume(userId);
    } catch {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Strangers can only act on a published listing: a draft or deleted one is "not found" to them. */
  private async assertVisible(propertyId: string): Promise<void> {
    await this.visibleOwnerId(propertyId);
  }

  /** The owner of a published listing; 404 when there is none. */
  private async visibleOwnerId(propertyId: string): Promise<string> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...PUBLISHED },
      select: { userId: true },
    });
    if (!property) {
      throw new NotFoundException('Property not found or not active');
    }
    return property.userId;
  }
}
