import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { clearedFieldsFor } from './property-type-fields';
import { TAKEOVER_LISTING_TYPE } from './property-options';
import { additionalPaymentRows, takeoverData, takeoverPrice } from './takeover';

const keywordRows = (keywords: string[]) =>
  keywords.map((keyword) => ({ keyword }));

/** The row (and its keywords) to insert for a new listing of `userId`. */
export function toCreateData(userId: string, dto: CreatePropertyDto) {
  const { status, keywords, takeover, ...fields } = dto;
  const isTakeover = fields.listingType === TAKEOVER_LISTING_TYPE;
  return {
    ...fields,
    ...(isTakeover && { price: takeoverPrice(takeover) ?? fields.price }),
    ...(isTakeover &&
      takeover && {
        takeover: {
          create: {
            ...takeoverData(takeover),
            additionalPayments: { create: additionalPaymentRows(takeover) },
          },
        },
      }),
    ...clearedFieldsFor(fields.propertyType),
    userId,
    status: status || 'Draft',
    // Created live: it is published now.
    ...(status === 'Active' && { publishedAt: new Date() }),
    ...(keywords?.length && { keywords: { create: keywordRows(keywords) } }),
  };
}

/**
 * The changes to write for an edit of a listing currently of `currentType`.
 * Details that do not belong to the resulting type are cleared, and a sent
 * keyword list replaces the old one.
 */
export function toUpdateData(
  dto: UpdatePropertyDto,
  currentType: string,
  currentListingType?: string | null,
  hasTakeover = false,
) {
  const { keywords, takeover, ...fields } = dto;
  const isTakeover =
    (fields.listingType !== undefined
      ? fields.listingType
      : currentListingType) === TAKEOVER_LISTING_TYPE;
  return {
    ...fields,
    ...(isTakeover &&
      takeover && {
        takeover: {
          upsert: {
            create: {
              ...takeoverData(takeover),
              additionalPayments: { create: additionalPaymentRows(takeover) },
            },
            update: {
              ...takeoverData(takeover),
              additionalPayments: {
                deleteMany: {},
                create: additionalPaymentRows(takeover),
              },
            },
          },
        },
      }),
    ...((!isTakeover || takeover === null) &&
      hasTakeover && { takeover: { delete: true } }),
    ...clearedFieldsFor(fields.propertyType ?? currentType),
    ...(keywords && {
      keywords: { deleteMany: {}, create: keywordRows(keywords) },
    }),
  };
}
