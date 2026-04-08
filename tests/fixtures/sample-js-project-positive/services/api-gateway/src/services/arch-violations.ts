import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
export function narrowData(data: unknown): { str: string } | null {
  if (typeof data === 'string') return { str: data };
  return null;
}
export function getMiddleware(): { auth: typeof authMiddleware; limit: typeof rateLimiter } {
  return { auth: authMiddleware, limit: rateLimiter };
}
