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



// --- missing-rate-limiting shape: router that imports and wires rate-limiting middleware ---
// Rule fires on import line 1, ignoring the middleware application below
declare function createHonoApp(): { use: (path: string, ...mw: unknown[]) => void; route: (path: string, router: unknown) => void };
declare const apiV1RateLimit: unknown;
declare const apiV2RateLimit: unknown;
declare const uploadRateLimit: unknown;
declare const authRateLimit: unknown;
declare const publicApiRouter: unknown;
declare const authRouter: unknown;
declare const uploadRouter: unknown;

const app = createHonoApp();

// Apply rate limiting per endpoint group
app.use('/api/v1/*', apiV1RateLimit);
app.use('/api/v2/*', apiV2RateLimit);
app.use('/api/upload/*', uploadRateLimit);
app.use('/api/auth/*', authRateLimit);

// Mount routers (which have their own auth checks)
app.route('/api/v1', publicApiRouter);
app.route('/api/auth', authRouter);
app.route('/api/upload', uploadRouter);



// FP shape: HTTP header name string in a single rate-limit middleware (protocol-api-vocabulary)
interface RateLimitResult {
  isLimited: boolean;
  reset: Date;
}

declare function checkRateLimit(ip: string, id: string): Promise<RateLimitResult>;

function createRateLimitMiddleware(limiter: unknown) {
  return async (req: { ip: string; id: string }, res: {
    setHeader: (name: string, value: string) => void;
    status: (code: number) => { json: (body: unknown) => void };
  }, next: () => void) => {
    const result = await checkRateLimit(req.ip, req.id);

    if (result.isLimited) {
      const retryAfter = Math.max(1, Math.ceil((result.reset.getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    next();
  };
}



declare const c: { json(body: unknown, status?: number): Response; header(name: string, value: string): void; };
declare function isThrottled(clientKey: string): boolean;

export function applyThrottleGuard(clientKey: string): Response | null {
  if (isThrottled(clientKey)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Too many requests, please try again later.' }, 429);
  }
  return null;
}



// 429 passed to HTTPException is the standard HTTP Too Many Requests status code
declare class HTTPException {
  constructor(status: number, opts: { res: unknown }): void;
}
declare function rateLimitResponse(c: unknown, result: unknown): unknown | null;
declare function loginRateLimit(): { check(opts: { ip: string; identifier: string }): Promise<unknown> };

async function authorizeHandler(c: { get(key: string): { ipAddress?: string } }, email: string): Promise<void> {
  const requestMetadata = c.get('requestMetadata');

  const limitResult = await loginRateLimit().check({
    ip: requestMetadata.ipAddress ?? 'unknown',
    identifier: email,
  });

  const limited = rateLimitResponse(c, limitResult);

  if (limited) {
    throw new HTTPException(429, { res: limited });
  }
}



// HTTP 429 Too Many Requests is the standard rate-limit status code
interface ApiError { status: number; message?: string; }

export function isRateLimitError(err: ApiError): boolean {
  return err.status === 429;
}

export function handleAiApiError(err: ApiError): string {
  if (err.status === 429) {
    return 'Rate limit exceeded. Please try again later.';
  }
  return 'An unexpected error occurred.';
}



const nonPagePathRegex = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;

export function isNonPagePath(path: string): boolean {
  return nonPagePathRegex.test(path);
}
