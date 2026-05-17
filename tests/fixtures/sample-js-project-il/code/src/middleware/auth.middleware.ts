import type { Request, Response, NextFunction } from 'express';
import type { ErrorEnvelope, AuthContext } from '../types.js';

/** Trivial token decoder — production would verify a JWT. */
function decodeToken(token: string): AuthContext | null {
  // Pretend tokens are `userid:roleA,roleB`.
  const [userId, rolesPart = ''] = token.split(':');
  if (!userId) return null;
  const roles = rolesPart.split(',').filter(Boolean);
  return { userId, roles };
}

export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    const envelope: ErrorEnvelope = {
      error: { code: 'unauthenticated', message: 'Missing or invalid Bearer token' },
    };
    res.status(401).json(envelope);
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const ctx = decodeToken(token);
  if (!ctx) {
    res.status(401).json({
      error: { code: 'unauthenticated', message: 'Invalid token' },
    } satisfies ErrorEnvelope);
    return;
  }
  req.auth = ctx;
  next();
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.roles.includes(role)) {
      res.status(403).json({
        error: { code: 'forbidden', message: `Requires role: ${role}` },
      } satisfies ErrorEnvelope);
      return;
    }
    next();
  };
}
