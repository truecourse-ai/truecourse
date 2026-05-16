
// shape: Hono route handler is async but only delegates to a request handler returning a Promise; async for Hono route handler signature conformance
declare function handleApiRequest(request: Request): Promise<Response>;
declare function listItemsHandler(request: Request): Promise<Response>;
declare function subscribeHandler(request: Request): Promise<Response>;
declare const honoApp: { get(path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>): typeof honoApp; all(path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>): typeof honoApp; mount(path: string, handler: (request: Request) => Promise<Response>): typeof honoApp };

honoApp
  .get('/api/me', async (c) => handleApiRequest(c.req.raw))
  .all('/api/items/list', async (c) => listItemsHandler(c.req.raw))
  .all('/api/integrations/subscribe', async (c) => subscribeHandler(c.req.raw));

honoApp.mount('/', async (request) => handleApiRequest(request));


// FP shape: Hono .get()/.delete() method chaining returns the route builder, not void.
// The result is assigned to the route variable; no void return value consumed.
declare const HonoApp: new () => {
  get: (path: string, handler: (c: { json: (data: unknown) => unknown; req: { param: (k: string) => string } }) => unknown) => HonoRouterInstance;
  delete: (path: string, handler: (c: { json: (data: unknown) => unknown; req: { param: (k: string) => string } }) => unknown) => HonoRouterInstance;
};
type HonoRouterInstance = InstanceType<typeof HonoApp>;

declare function getUserTokens(c: unknown): Promise<{ tokens: string[] }>;
declare function revokeToken(c: unknown, tokenId: string): Promise<void>;
declare const superjsonPack: { serialize: (v: unknown) => unknown };

const tokenRouter = new HonoApp();

tokenRouter.get('/tokens', async (c) => {
  const result = await getUserTokens(c);
  return c.json(superjsonPack.serialize({ tokens: result.tokens }));
});

tokenRouter.delete('/token/:tokenId', async (c) => {
  const tokenId = c.req.param('tokenId');
  await revokeToken(c, tokenId);
  return c.json({ success: true });
});



// Hono route registration with c.json — c.json accepts any JSON-serializable value
declare const openApiDocument: Record<string, unknown>;

interface HonoCtx {
  json(value: unknown): Response;
  redirect(url: string, status?: number): Response;
}

interface HonoApp {
  get(path: string, handler: (c: HonoCtx) => Response): HonoApp;
}

declare const apiApp: HonoApp;

apiApp.get('/v2/openapi.json', (c) => c.json(openApiDocument));



// Hono route handler with c.redirect(url) — c.redirect accepts a string URL, no type mismatch
interface HonoRedirectCtx {
  redirect(url: string, status?: number): Response;
  json(value: unknown): Response;
}

declare const publicApiApp: { get(path: string, handler: (c: HonoRedirectCtx) => Response): typeof publicApiApp };

publicApiApp
  .get('/openapi', (c) => c.redirect('/v1/openapi.json'))
  .get('/docs', (c) => c.redirect('/v1/docs/index.html'))
  .get('/health', (c) => c.json({ status: 'ok' }));



// void-return-value-used: forEach returns undefined — assigning its result is a bug
declare const activeRouteIds: string[];
declare function invalidateRouteCache(id: string): void;

function flushRouteCaches(): void {
  // TS2454 / lint: forEach returns undefined, not an array
  const flushed = activeRouteIds.forEach((id) => invalidateRouteCache(id));
}

