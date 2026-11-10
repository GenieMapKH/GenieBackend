import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';
import { ForgotPasswordDto } from './forgot-password.dto';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './reset-password.dto';

function parse<T extends object>(dto: new () => T, plain: object) {
  const instance = plainToInstance(dto, plain);
  return {
    instance,
    errors: validateSync(instance, { whitelist: true }).map((e) => e.property),
  };
}

describe('email fields', () => {
  it.each([RegisterDto, LoginDto, ForgotPasswordDto])(
    '%p lower-cases and trims the email',
    (dto) => {
      const { instance, errors } = parse(dto as new () => { email?: string }, {
        email: '  Foo@Gmail.COM ',
        phone: '012 345 678',
        password: 'password123',
      });

      expect(errors).toEqual([]);
      expect(instance.email).toBe('foo@gmail.com');
    },
  );
});

describe('RegisterDto', () => {
  const phone = '012 345 678';

  it('accepts a password of 72 bytes and refuses 73', () => {
    expect(
      parse(RegisterDto, { phone, password: 'a'.repeat(72) }).errors,
    ).toEqual([]);
    expect(
      parse(RegisterDto, { phone, password: 'a'.repeat(73) }).errors,
    ).toEqual(['password']);
  });

  it('counts bytes, not characters: 40 Khmer letters are over the limit', () => {
    expect(
      parse(RegisterDto, { phone, password: 'ក'.repeat(40) }).errors,
    ).toEqual(['password']);
  });

  it('requires a phone number, even when an email is given', () => {
    expect(
      parse(RegisterDto, { email: 'a@b.com', password: 'password123' }).errors,
    ).toEqual(['phone']);
  });

  it('stores every common spelling of a number as E.164', () => {
    for (const typed of ['+85512345678', '012 345 678', '855 (12) 345-678']) {
      const { instance, errors } = parse(RegisterDto, {
        phone: typed,
        password: 'password123',
      });
      expect(errors).toEqual([]);
      expect(instance.phone).toBe('+85512345678');
    }
  });

  it.each([
    'abc',
    "012345678' OR '1'='1",
    '<img src=x onerror=alert(1)>',
    12345678,
    ['012345678'],
  ])('refuses %j as a phone number', (bad) => {
    expect(
      parse(RegisterDto, { phone: bad, password: 'password123' }).errors,
    ).toEqual(['phone']);
  });

  it('treats a blank email and name as not given', () => {
    const { instance, errors } = parse(RegisterDto, {
      phone,
      email: '  ',
      name: ' ',
      password: 'password123',
    });
    expect(errors).toEqual([]);
    expect(instance.email).toBeUndefined();
    expect(instance.name).toBeUndefined();
  });

  it('refuses an email that is not one, or too long to be one', () => {
    for (const email of ['not-an-email', `${'a'.repeat(250)}@b.com`, 42]) {
      expect(
        parse(RegisterDto, { phone, email, password: 'password123' }).errors,
      ).toEqual(['email']);
    }
  });

  it('trims the name and refuses markup, control characters and over 60 letters', () => {
    expect(
      parse(RegisterDto, {
        phone,
        name: '  សុខ ដារា ',
        password: 'password123',
      }).instance.name,
    ).toBe('សុខ ដារា');
    for (const name of ['<script>alert(1)</script>', 'ab', 'x'.repeat(61)]) {
      expect(
        parse(RegisterDto, { phone, name, password: 'password123' }).errors,
      ).toEqual(['name']);
    }
  });
});

describe('LoginDto', () => {
  it('reads the phone number the way registration stored it', () => {
    const { instance, errors } = parse(LoginDto, {
      phone: '012-345-678',
      password: 'x',
    });
    expect(errors).toEqual([]);
    expect(instance.phone).toBe('+85512345678');
  });

  it.each([
    { phone: "' OR 1=1 --", password: 'x' },
    { phone: { $ne: null }, password: 'x' },
    { email: { $gt: '' }, password: 'x' },
    { email: `${'a'.repeat(250)}@b.com`, password: 'x' },
    { email: 'a@b.com', password: { $ne: null } },
    { email: 'a@b.com', password: 'x'.repeat(201) },
  ])('refuses %j', (body) => {
    expect(parse(LoginDto, body).errors).not.toEqual([]);
  });
});

describe('other password fields', () => {
  it('refuses a new password over 72 bytes when it is changed or reset', () => {
    const long = 'p'.repeat(73);
    expect(
      parse(ChangePasswordDto, { currentPassword: 'x', newPassword: long })
        .errors,
    ).toEqual(['newPassword']);
    expect(
      parse(ResetPasswordDto, {
        email: 'a@b.com',
        otp: '123456',
        newPassword: long,
      }).errors,
    ).toEqual(['newPassword']);
  });

  it('still lets an existing long password sign in (it only has to fit in a normal request)', () => {
    expect(
      parse(LoginDto, { email: 'a@b.com', password: 'p'.repeat(100) }).errors,
    ).toEqual([]);
    expect(
      parse(LoginDto, { email: 'a@b.com', password: 'p'.repeat(201) }).errors,
    ).toEqual(['password']);
  });
});
