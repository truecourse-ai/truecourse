import { Request } from 'express';

const MIN_TOKEN_LENGTH = 8;
const DEFAULT_ERROR_CODE = 400;

export function requireAuth(req: Request): { userId: string; role: string } {
  const token = req.headers.authorization;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    throw new Error('Invalid token');
  }
  return { userId: '1', role: 'admin' };
}

export function formatError(message: string, code: number = DEFAULT_ERROR_CODE): { error: string; code: number } {
  return { error: message, code };
}
