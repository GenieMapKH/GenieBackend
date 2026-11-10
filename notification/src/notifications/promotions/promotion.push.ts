import { PushContent, PushTarget } from '../delivery/push-sender';

/** The parts of a promotion that make up its push. */
export interface PromotionMessage {
  id: string;
  title: string;
  body: string;
  titleKm: string | null;
  bodyKm: string | null;
  propertyId: string | null;
  url: string | null;
  imageUrl: string | null;
}

/** In Khmer where the device is set to Khmer and the text was written in it. */
export function promotionPush(
  promotion: PromotionMessage,
  target: PushTarget,
): PushContent {
  const khmer = target.locale === 'km';
  return {
    alert: {
      title: (khmer && promotion.titleKm) || promotion.title,
      body: (khmer && promotion.bodyKm) || promotion.body,
      imageUrl: promotion.imageUrl ?? undefined,
    },
    data: {
      type: 'promotion',
      promotionId: promotion.id,
      ...(promotion.propertyId && { propertyId: promotion.propertyId }),
      ...(promotion.url && { url: promotion.url }),
    },
    channel: 'promotions',
    tag: `promotion:${promotion.id}`,
    urgent: false,
  };
}
