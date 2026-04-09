/**
 * Express error handling middleware.
 */

import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction) {
  // VIOLATION: code-quality/deterministic/console-log
  console.log('Error caught by handler:', err.message);

  const statusCode = err.statusCode || 500;

  // NOTE: architecture/deterministic/raw-error-in-response — not detected by visitor in this file
  res.status(statusCode).json({
    error: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Wraps async route handlers to catch errors.
 */
// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// VIOLATION: code-quality/deterministic/missing-return-type
export function createHttpError(message: string, statusCode: number): AppError {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  return error;
}
