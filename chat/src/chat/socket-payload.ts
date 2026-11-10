import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/** Reads a socket payload into a DTO, or returns null if it is not valid. */
export function parsePayload<T extends object>(
  dto: new () => T,
  payload: unknown,
): T | null {
  const isObject =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload);
  const parsed = plainToInstance(dto, isObject ? payload : {});
  return validateSync(parsed, { whitelist: true }).length > 0 ? null : parsed;
}
