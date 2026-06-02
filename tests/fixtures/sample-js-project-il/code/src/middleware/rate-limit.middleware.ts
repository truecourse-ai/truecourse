import type { Request, Response, NextFunction } from 'express';

// Per-client request ceiling. This number was chosen to match the upstream
// gateway's burst allowance, but it lives only in code — no spec, ADR, or
// runbook records it.
export const RATE_LIMIT_PER_MINUTE = 100;

interface Slot {
  count: number;
  resetAt: number;
}

const hits = new Map<string, Slot>();

/**
 * Fixed-window in-memory rate limiter. Good enough for a single instance;
 * the production gateway enforces the real limit, this is a backstop.
 */
export function rateLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const slot = hits.get(key);
    if (!slot || slot.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (slot.count >= RATE_LIMIT_PER_MINUTE) {
      return res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests' },
      });
    }
    slot.count += 1;
    return next();
  };
}
