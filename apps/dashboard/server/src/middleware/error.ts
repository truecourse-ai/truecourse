import type { Request, Response, NextFunction } from 'express';
import { log } from '@truecourse/core/lib/logger';
import type { AppError } from '@truecourse/core/lib/errors';

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  log.error(`[ERROR] ${statusCode} - ${message}`);
  if (statusCode === 500 && err.stack) {
    log.error(err.stack);
  }

  res.status(statusCode).json({ error: message });
}
