import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../middleware/auth';
export function catchTyped(): void {
  try { throw new Error('test'); } catch { logger.error('Caught an error'); }
}
export function parseInput(input: string): unknown {
  try { return JSON.parse(input) as unknown; } catch { throw new Error('Invalid JSON'); }
}
export function getAuth(): string { return `auth:${typeof authMiddleware}`; }
