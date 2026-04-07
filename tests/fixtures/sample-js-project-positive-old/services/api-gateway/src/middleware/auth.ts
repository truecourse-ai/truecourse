import { NextFunction, Request, Response } from 'express';

interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  req.userId = 'authenticated-user';
  next();
}
