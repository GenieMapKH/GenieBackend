import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

function parse(plain: object) {
  const instance = plainToInstance(UpdateProfileDto, plain);
  return {
    instance,
    errors: validateSync(instance, { whitelist: true }).map((e) => e.property),
  };
}

describe('UpdateProfileDto phone', () => {
  it('stores the number the way sign-up does', () => {
    const { instance, errors } = parse({ phone: '012 345 678' });
    expect(errors).toEqual([]);
    expect(instance.phone).toBe('+85512345678');
  });

  it.each([null, '', 'abc', "012345678' OR '1'='1"])(
    'refuses %j: the number cannot be cleared or garbled',
    (phone) => {
      expect(parse({ phone }).errors).toEqual(['phone']);
    },
  );

  it('leaves the number alone when it is not sent', () => {
    expect(parse({ name: 'Dara' }).errors).toEqual([]);
  });
});
