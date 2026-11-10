import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/** True when any text inside `value` (at any depth) holds a NUL character. */
export function containsNullByte(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsNullByte);
  if (value !== null && typeof value === 'object')
    return Object.values(value).some(containsNullByte);
  return false;
}

/**
 * Postgres cannot store a NUL character in text, so the insert would fail and
 * the caller would see a 500. Refused up front as the bad input it is.
 * Register before the ValidationPipe.
 */
@Injectable()
export class RejectNullBytesPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (
      (metadata.type === 'body' || metadata.type === 'query') &&
      containsNullByte(value)
    ) {
      throw new BadRequestException('Text cannot contain null characters');
    }
    return value;
  }
}
