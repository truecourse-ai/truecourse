/**
 * Negative fixture for reliability/deterministic/missing-next-on-error.
 *
 * Express-shaped middleware with `(req, res, next)`. The catch block must
 * forward the error via `next(err)` to reach Express's error handler;
 * sending a 500 response and returning is not equivalent because downstream
 * error middleware never runs.
 */

import { Request, Response, NextFunction } from 'express';

const decodeAuthToken = (raw: string): { sub: string } => {
  if (!raw) throw new Error('empty token');
  return { sub: raw };
};

// VIOLATION: reliability/deterministic/missing-next-on-error
export function attachUserMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const token = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/, '');
    const claims = decodeAuthToken(token);
    (req as Request & { user?: { sub: string } }).user = claims;
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthorized' });
  }
}
