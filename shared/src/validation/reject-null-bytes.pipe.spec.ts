import { BadRequestException } from '@nestjs/common';
import {
  containsNullByte,
  RejectNullBytesPipe,
} from './reject-null-bytes.pipe';

describe('containsNullByte', () => {
  it('finds a NUL in nested text', () => {
    expect(containsNullByte({ a: [{ b: 'x\u0000y' }] })).toBe(true);
  });

  it('accepts ordinary values', () => {
    expect(containsNullByte({ a: ['x', 1, null, { b: true }], c: 'ok' })).toBe(
      false,
    );
  });
});

describe('RejectNullBytesPipe', () => {
  const pipe = new RejectNullBytesPipe();

  it('refuses a body with a NUL character', () => {
    expect(() =>
      pipe.transform({ title: 'a\u0000' }, { type: 'body' }),
    ).toThrow(BadRequestException);
  });

  it('leaves route parameters to their own pipes', () => {
    expect(pipe.transform('a\u0000', { type: 'param' })).toBe('a\u0000');
  });

  it('passes a clean body through unchanged', () => {
    const body = { title: 'fine' };
    expect(pipe.transform(body, { type: 'body' })).toBe(body);
  });
});
