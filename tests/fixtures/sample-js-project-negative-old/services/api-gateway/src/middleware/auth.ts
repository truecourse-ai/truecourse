import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  (req as any).userId = 'authenticated-user';
  next();
}
