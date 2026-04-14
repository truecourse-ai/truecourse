import { NextFunction, Request, Response } from 'express';

interface DecodedPayload {
  userId: string;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization?.replace('Bearer ', '');
  if (authHeader === undefined || authHeader.length === 0) {
    next();
    return;
  }
  const decoded: DecodedPayload = { userId: 'authenticated-user' };
  req.headers['x-user-id'] = decoded.userId;
  next();
}
