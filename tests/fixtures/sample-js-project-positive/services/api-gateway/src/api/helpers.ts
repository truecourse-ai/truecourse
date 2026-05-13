/**
 * API helpers -- sits in api/ directory but is NOT a route handler.
 */

import { Request } from 'express';

const MIN_TOKEN_LENGTH = 8;

export function requireAuth(req: Request): { userId: string; role: string } {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined || authHeader.length < MIN_TOKEN_LENGTH) {
    throw new Error('Invalid authorization header');
  }
  return { userId: '1', role: 'admin' };
}

export function formatError(message: string, code: number = 400): { error: string; code: number } {
  return { error: message, code };
}
