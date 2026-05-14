
// FF06 — Hono error handler with instanceof check; argument types match
declare class AppError extends Error { status: number; message: string; }
declare function createJsonResponse(ctx: HonoContext, body: unknown, status: number): Response;
interface HonoContext { json(body: unknown, status?: number): Response; }
declare const router: { onError(handler: (err: unknown, ctx: HonoContext) => Response | void): void };

router.onError((err, ctx) => {
  if (err instanceof AppError) {
    return ctx.json({ error: err.message }, err.status);
  }
});



// --- inconsistent-return shape: Hono rate-limit middleware (framework mixed return) ---
// Returns a Response when rate-limited vs void from next(). This is idiomatic
// Hono middleware pattern; the framework handles both return shapes correctly.
declare type HonoCtx = {
  header: (k: string, v: string) => void;
  json: (body: unknown, status: number) => Response;
};
declare type NextHandler = () => Promise<void>;
declare function checkRateLimit(ip: string): { isLimited: boolean; remaining: number; reset: Date };
declare function resolveIp(req: Request): string;

export const rateLimitMiddleware = async (c: HonoCtx & { req: { raw: Request } }, next: NextHandler) => {
  const ip = resolveIp(c.req.raw);
  const result = checkRateLimit(ip);

  c.header('X-RateLimit-Remaining', String(result.remaining));

  if (result.isLimited) {
    return c.json({ error: 'Too many requests, please try again later.' }, 429);
  }

  await next();
};
