/**
 * Paraphrased FP from documenso/documenso for
 * architecture/deterministic/route-without-auth-middleware.
 *
 * Two distinct shapes:
 *   1. `app.use(...)` / `router.use(...)` — middleware registration or
 *      sub-router mount; not a route handler that itself needs an auth
 *      middleware in its argument list.
 *   2. Route handlers that authenticate via a credential embedded in the URL
 *      path (`/:token`, `/:apiKey`, …). The handler validates the token
 *      against the database; an auth middleware is not the auth mechanism.
 */

interface Ctx {
  req: { valid: (kind: 'param') => Record<string, string> };
  json: (body: unknown, status?: number) => Response;
}

interface Hono {
  use(path: string, mw: (c: Ctx) => Response): void;
  route(path: string, sub: unknown): void;
  get(path: string, handler: (c: Ctx) => Response): void;
}

declare const app: Hono;
declare const apiV1RateLimitMiddleware: (c: Ctx) => Response;
declare const trpcRateLimitMiddleware: (c: Ctx) => Response;
declare const filesRoute: unknown;

export function mountRouter(): void {
  // `.use(path, mw)` is middleware registration, not a route handler.
  app.use('/api/v1/*', apiV1RateLimitMiddleware);
  app.use('/api/trpc/*', trpcRateLimitMiddleware);
  app.use('/api/trpc/*', () => new Response(null));
  // `.route(path, sub)` mounts a sub-router; auth is enforced inside.
  app.route('/api/files', filesRoute);
}

export function registerTokenAuthedRoute(): void {
  // The route authenticates via the URL-embedded `:token` parameter — the
  // handler reads it from params and validates it server-side. No auth
  // middleware in the chain by design.
  app.get('/token/:token/envelope/:envelopeId/item.pdf', (c) => {
    const { token } = c.req.valid('param');
    return c.json({ ok: token.length > 0 });
  });
}
