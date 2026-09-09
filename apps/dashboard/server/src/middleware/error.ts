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

  // Driver errors may include SQL parameters containing entire transcripts
  // or credentials. Keep internal failure details out of browser responses.
  res.status(statusCode).json({ error: statusCode >= 500 ? 'Internal server error. Please try again.' : message });
}
