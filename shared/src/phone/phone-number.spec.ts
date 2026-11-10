import { normalizePhoneNumber, phoneNumberVariants } from './phone-number';

describe('normalizePhoneNumber', () => {
  it.each([
    '012 345 678',
    '012-345-678',
    '(012) 345.678',
    '12345678',
    '85512345678',
    '+85512345678',
    '+855 12 345 678',
    '+855 012 345 678',
    '00855 12 345 678',
  ])('reads %s as a Cambodian number', (typed) => {
    expect(normalizePhoneNumber(typed)).toBe('+85512345678');
  });

  it('keeps 9-digit Cambodian numbers', () => {
    expect(normalizePhoneNumber('097 1234 567')).toBe('+855971234567');
  });

  it('keeps other countries when they carry their code', () => {
    expect(normalizePhoneNumber('+66 81 234 5678')).toBe('+66812345678');
    expect(normalizePhoneNumber('0066812345678')).toBe('+66812345678');
  });

  it.each([
    '',
    '+',
    '012',
    '0123456789012',
    '+855 12',
    '+0 123 456 789',
    '012345678a',
    "012345678' OR '1'='1",
    '<script>012345678</script>',
    '+1234567890123456',
    '０１２３４５６７８',
  ])('refuses %j', (typed) => {
    expect(normalizePhoneNumber(typed)).toBeNull();
  });
});

describe('phoneNumberVariants', () => {
  it('lists the older stored spellings of a Cambodian number', () => {
    expect(phoneNumberVariants('+85512345678')).toEqual([
      '+85512345678',
      '85512345678',
      '012345678',
    ]);
  });

  it('has no local spelling for other countries', () => {
    expect(phoneNumberVariants('+66812345678')).toEqual([
      '+66812345678',
      '66812345678',
    ]);
  });
});
