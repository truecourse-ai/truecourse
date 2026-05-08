// VIOLATION: style/deterministic/sorting-style
import { Request, Response, NextFunction } from 'express';

// VIOLATION: code-quality/deterministic/missing-return-type
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  // VIOLATION: code-quality/deterministic/unsafe-any-usage
  const decoded: any = 'authenticated-user';
  decoded.userId;
  next();
}
