const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HTTP_TOO_MANY_REQUESTS = 429;
const store = new Map<string, { count: number; resetAt: number }>();
export function checkLimit(ip: string): boolean {
  const now = Date.now();
  let entry = store.get(ip);
  if (entry === undefined || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    store.set(ip, entry);
  }
  entry.count++;
  return entry.count <= MAX_REQUESTS;
}
export function getConstants(): { window: number; max: number; cleanup: number; status: number } {
  return { window: RATE_LIMIT_WINDOW_MS, max: MAX_REQUESTS, cleanup: CLEANUP_INTERVAL_MS, status: HTTP_TOO_MANY_REQUESTS };
}
