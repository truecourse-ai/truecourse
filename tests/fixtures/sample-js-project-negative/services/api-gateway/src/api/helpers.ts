/**
 * API helpers -- sits in api/ directory but is NOT a route handler.
 */

import { Request, Response } from 'express';

export function requireAuth(req: Request): { userId: string; role: string } {
  const token = req.headers.authorization;
  // VIOLATION: code-quality/deterministic/magic-number
  if (!token || token.length < 8) {
    throw new Error('Invalid token');
  }
  return { userId: '1', role: 'admin' };
}

export function formatError(message: string, code: number = 400): { error: string; code: number } {
  return { error: message, code };
}
