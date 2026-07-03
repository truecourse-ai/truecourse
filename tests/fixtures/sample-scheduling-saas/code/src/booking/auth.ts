import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../shared/errors.js';

/**
 * Decode a customer access token. Production verifies a real JWT and reads the
 * subject (ADR 0001); for the fixture the bearer token IS the customer id.
 */
function decode(token: string): string | null {
  const customerId = token.trim();
  return customerId.length > 0 ? customerId : null;
}

/**
 * Bearer-JWT gate for the booking app. Every `/api/*` endpoint requires a
 * customer token (ADR 0001); the token subject becomes `req.customer`.
 * Per-appointment ownership is enforced in the services.
 */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'unauthenticated', 'Missing or invalid Bearer token');
  }
  const customerId = decode(header.slice('Bearer '.length));
  if (!customerId) {
    throw new ApiError(401, 'unauthenticated', 'Invalid token');
  }
  req.customer = { customerId };
  next();
}
