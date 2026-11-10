import { PropertyType } from './property-options';

/**
 * The details that only some property types have. A listing keeps those of
 * its own type; the others are cleared, so a listing whose type changed
 * cannot show (or match a filter on) details left over from its old type.
 */
export const TYPE_SPECIFIC_FIELDS = [
  'bedrooms',
  'bathrooms',
  'landSize',
  'buildingSize',
  'unitSize',
  'totalProjectArea',
  'floors',
  'floorNumber',
  'totalUnits',
  'hasParking',
  'hasBalcony',
  'furnishing',
  'buildingType',
  'completionStatus',
  'viewType',
  'maintenanceFee',
  'developerName',
  'projectName',
  'projectType',
  'monthlyRent',
  'leaseRemainingMonths',
  'equipmentIncluded',
  'reasonForSelling',
] as const;
export type TypeSpecificField = (typeof TYPE_SPECIFIC_FIELDS)[number];

/** Which details each property type's form asks for. */
export const FIELDS_BY_TYPE: Record<
  PropertyType,
  readonly TypeSpecificField[]
> = {
  Land: ['landSize'],
  House: [
    'landSize',
    'buildingSize',
    'bedrooms',
    'bathrooms',
    'floors',
    'hasParking',
    'furnishing',
  ],
  Warehouse: ['landSize', 'buildingSize', 'floors', 'hasParking'],
  Building: [
    'buildingType',
    'landSize',
    'buildingSize',
    'floors',
    'totalUnits',
    'hasParking',
  ],
  Condo: [
    'unitSize',
    'floorNumber',
    'floors',
    'bedrooms',
    'bathrooms',
    'hasBalcony',
    'furnishing',
    'completionStatus',
    'viewType',
    'maintenanceFee',
  ],
  Borey: [
    'developerName',
    'projectName',
    'projectType',
    'totalProjectArea',
    'totalUnits',
    'completionStatus',
  ],
  'Business for Sale': [
    'landSize',
    'monthlyRent',
    'leaseRemainingMonths',
    'equipmentIncluded',
    'reasonForSelling',
  ],
};

export type SizeField =
  'landSize' | 'buildingSize' | 'unitSize' | 'totalProjectArea';

/**
 * The one size a listing's cards show and the size filter reads, as the
 * app picks it: the plot of land or a business, the floor area of a built
 * property, the unit of a condo, the whole project of a Borey.
 */
export const SIZE_FIELD_BY_TYPE: Record<PropertyType, SizeField> = {
  Land: 'landSize',
  'Business for Sale': 'landSize',
  House: 'buildingSize',
  Building: 'buildingSize',
  Warehouse: 'buildingSize',
  Condo: 'unitSize',
  Borey: 'totalProjectArea',
};

/**
 * `null` for every detail `type` does not have, ready to spread into a
 * Prisma write. Unknown (legacy) types keep everything.
 */
export function clearedFieldsFor(
  type: string,
): Partial<Record<TypeSpecificField, null>> {
  const kept = FIELDS_BY_TYPE[type as PropertyType];
  if (!kept) return {};
  return Object.fromEntries(
    TYPE_SPECIFIC_FIELDS.filter((field) => !kept.includes(field)).map(
      (field) => [field, null],
    ),
  );
}
