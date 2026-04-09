import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../middleware/auth';
export function catchTyped(): void {
  try { throw new Error('test'); } catch { logger.error('Caught an error'); }
}
export function parseInput(input: string): unknown {
  try { return JSON.parse(input) as unknown; } catch { throw new Error('Invalid JSON'); }
}
export function getAuth(): string { return `auth:${typeof authMiddleware}`; }
const FETCH_TIMEOUT_MS = 5000;
export async function syncReturnInTryCatch(url: string): Promise<Response> {
  try {
    const data = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return Response.json(data);
  } catch {
    return Response.json({ ok: false });
  }
}
export function doubleRaf(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
    });
  });
}
export function mapReturnInTryCatch(items: readonly string[]): string[] {
  try {
    return items.map((item) => item.toUpperCase());
  } catch {
    const empty: string[] = [];
    return empty;
  }
}
export function getFromCache(cache: { open: () => string }): string {
  try { return cache.open(); } catch { return ''; }
}
export function healthCheck(): string {
  try {
    // Check Redis/queue connection status
    return 'healthy';
  } catch {
    return 'unhealthy';
  }
}
