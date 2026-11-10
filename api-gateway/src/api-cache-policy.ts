import type { NextFunction, Request, Response } from 'express';

export function apiCachePolicy(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
