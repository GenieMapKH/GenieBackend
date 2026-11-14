import {
  PROPERTY_DETAIL_WITH_RELATIONS,
  PROPERTY_WITH_RELATIONS,
  MAP_SELECT,
} from './property-includes';

describe('listing contact identity selection', () => {
  it('details select only contact values and their verification flags', () => {
    expect(PROPERTY_DETAIL_WITH_RELATIONS.user.select).toMatchObject({
      email: true,
      phone: true,
      emailVerified: true,
      phoneVerified: true,
    });
    expect(PROPERTY_DETAIL_WITH_RELATIONS.user.select).not.toHaveProperty(
      'passwordHash',
    );
  });
  it('bulk cards and ordinary listing relations do not disclose account contacts', () => {
    for (const select of [
      MAP_SELECT.user.select,
      PROPERTY_WITH_RELATIONS.user.select,
    ]) {
      expect(select).not.toHaveProperty('email');
      expect(select).not.toHaveProperty('phone');
    }
  });
});
