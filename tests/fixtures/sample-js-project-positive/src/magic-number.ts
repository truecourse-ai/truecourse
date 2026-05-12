/**
 * Numbers that should NOT trigger magic-number.
 *
 * - HTTP status codes passed to response helpers / exception constructors are
 *   well-known protocol constants.
 * - Zod-style schema validation thresholds (min/max/length/default) for password
 *   policy and pagination defaults are named policy constraints.
 * - Universal domain constants: RGB channel max (255), cardinal rotation (90),
 *   binary unit (1024) and time conversion factor (1000) are common knowledge.
 * - Numeric size arguments to ID/token generators like nanoid are conventional.
 * - Millisecond delays passed to setTimeout / debounce hooks are obvious UI
 *   timing constants from the surrounding API.
 */

interface ResponseContext {
  json(body: unknown, status: number): Response;
}

class HTTPException extends Error {
  constructor(
    public readonly status: number,
    public readonly options: { message: string },
  ) {
    super(options.message);
  }
}

declare const c: ResponseContext;

export function sendNotFound(): Response {
  return c.json({ error: 'Document not found' }, 404);
}

export function sendForbidden(): Response {
  return c.json({ error: 'Forbidden' }, 403);
}

export function throwRateLimited(): never {
  throw new HTTPException(429, { message: 'Too many requests' });
}

interface ZodLike {
  min(value: number, message?: string): ZodLike;
  max(value: number, message?: string): ZodLike;
  length(value: number, message?: string): ZodLike;
  default(value: number): ZodLike;
  optional(): ZodLike;
}

declare const z: { string(): ZodLike; number(): ZodLike };

export const passwordSchema = z.string().min(8, 'Password too short').max(72, 'Password too long');
export const perPageSchema = z.number().default(10).optional();

declare const perPageInput: string | undefined;
export const perPage = Number(perPageInput) || 10;

export function normalizeRgb(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255];
}

export function snapToCardinalRotation(degrees: number): number {
  return Math.round(degrees / 90) * 90;
}

export function isLandscape(pageRotationInDegrees: number): boolean {
  return pageRotationInDegrees === 90 || pageRotationInDegrees === 270;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const POLL_INTERVAL_MS = 60 * 1000;

declare function nanoid(size: number): string;
declare function customAlphabet(alphabet: string, size: number): () => string;

export function makeFieldId(): string {
  return nanoid(12);
}

export const makeShortCode = customAlphabet('0123456789ABCDEF', 8);

declare function useDebouncedValue<T>(value: T, delayMs: number): T;

export function useDocumentSearch(query: string): string {
  return useDebouncedValue(query, 500);
}

export function scheduleReveal(callback: () => void): void {
  setTimeout(callback, 250);
}
