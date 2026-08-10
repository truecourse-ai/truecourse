/**
 * Rate limiter middleware — limits requests per IP.
 */

import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      // VIOLATION: code-quality/deterministic/magic-number
      resetAt: now + 60 * 1000,
    };
    store.set(ip, entry);
  }

  entry.count++;

  // VIOLATION: code-quality/deterministic/magic-number
  if (entry.count > 100) {
    // VIOLATION: code-quality/deterministic/magic-number
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  // VIOLATION: code-quality/deterministic/magic-number
  res.setHeader('X-RateLimit-Remaining', String(100 - entry.count));
  next();
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function strictRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();

  let entry = store.get(`strict:${ip}`);

  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      // VIOLATION: code-quality/deterministic/magic-number
      resetAt: now + 60 * 1000,
    };
    store.set(`strict:${ip}`, entry);
  }

  entry.count++;

  // VIOLATION: code-quality/deterministic/magic-number
  if (entry.count > 10) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  next();
}

// Periodically clean up expired entries
// VIOLATION: performance/deterministic/settimeout-setinterval-no-clear
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
  // VIOLATION: code-quality/deterministic/magic-number
}, 5 * 60 * 1000);
