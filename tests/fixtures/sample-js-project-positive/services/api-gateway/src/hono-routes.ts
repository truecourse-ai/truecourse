
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
