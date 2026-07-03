import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** The standard error body: an HTTP status plus a machine-readable code. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * A failure carrying the HTTP status and machine code from the PRD error
 * tables (e.g. `409 too_late`, `422 slot_invalid`). Thrown from services and
 * middleware; rendered by `errorHandler`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

/** Wrap an async route handler so a rejected promise reaches `errorHandler`. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Terminal error middleware — renders `ApiError` as the standard envelope. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    } satisfies ErrorEnvelope);
    return;
  }
  res.status(500).json({
    error: { code: 'internal', message: 'Unexpected error' },
  } satisfies ErrorEnvelope);
}
