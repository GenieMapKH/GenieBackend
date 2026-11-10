import { BadRequestException } from '@nestjs/common';

export interface Discount {
  price: number;
  discountType?: string | null;
  discountValue?: number | null;
}

/**
 * A discount is either absent (type and value both empty) or makes sense for
 * the price: a percentage between 0 and 100, or an amount below the price.
 * The database refuses anything else too (migration 16); this says why.
 */
export function assertValidDiscount({
  price,
  discountType,
  discountValue,
}: Discount): void {
  const hasType = discountType != null;
  const hasValue = discountValue != null;
  if (!hasType && !hasValue) return;
  if (hasType !== hasValue) {
    throw new BadRequestException(
      'A discount needs both its type and its value',
    );
  }
  if (discountValue! <= 0) {
    throw new BadRequestException('A discount must be more than 0');
  }
  if (discountType === 'percent' && discountValue! >= 100) {
    throw new BadRequestException('A percentage discount must be below 100%');
  }
  if (discountType === 'amount' && discountValue! >= price) {
    throw new BadRequestException('A discount must be smaller than the price');
  }
}
