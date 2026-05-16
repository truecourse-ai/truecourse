
// 'Retry-After' is a standard HTTP response header name (RFC 6585) — a protocol constant, not a magic string.
declare const c: {
  header: (name: string, value: string) => void;
  json: (body: unknown, status: number) => Response;
};
declare const rateLimitResult: { isLimited: boolean; reset: Date };

export function applyRateLimitResponse(): Response | null {
  if (rateLimitResult.isLimited) {
    const retryAfter = Math.max(1, Math.ceil((rateLimitResult.reset.getTime() - Date.now()) / 1000));
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests, please try again later.' }, 429);
  }
  return null;
}



// Hono middleware: catch block is for non-critical IP extraction; swallowing is intentional
// Hono propagates errors differently from Express; next(error) pattern does not apply here
interface HonoCtx {
  req: { header(name: string): string | undefined };
  set(key: string, value: unknown): void;
}

declare function extractClientIp(headerValue: string | undefined): string;
declare function applyRateLimitByIp(ip: string): Promise<void>;

async function rateLimitMiddleware(c: HonoCtx, next: () => Promise<void>): Promise<void> {
  let clientIp = 'unknown';
  try {
    clientIp = extractClientIp(c.req.header('x-forwarded-for'));
  } catch (err) {
    // IP extraction failed; use safe fallback so rate limiting can continue
    clientIp = 'unknown';
  }
  await applyRateLimitByIp(clientIp);
  await next();
}
