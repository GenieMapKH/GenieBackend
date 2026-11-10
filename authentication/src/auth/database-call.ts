import { InternalServerErrorException, Logger } from '@nestjs/common';

/** Prisma's code for a write that broke a unique constraint. */
export const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === UNIQUE_CONSTRAINT_VIOLATION;
}

/**
 * Logs an unexpected database failure with its cause and returns the error
 * the client sees: only [publicMessage], so database details never leave the service.
 */
export function databaseFailure(
  logger: Logger,
  publicMessage: string,
  error: unknown,
): InternalServerErrorException {
  logger.error(`${publicMessage}: ${(error as Error)?.message ?? error}`);
  return new InternalServerErrorException(publicMessage);
}

/** Runs one database call; an unexpected failure becomes [databaseFailure]. */
export async function databaseCall<T>(
  logger: Logger,
  publicMessage: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw databaseFailure(logger, publicMessage, error);
  }
}
