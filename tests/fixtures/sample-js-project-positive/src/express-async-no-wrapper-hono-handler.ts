// Paraphrased FP for reliability/deterministic/express-async-no-wrapper.
//
// Hono handlers take a single Context argument — `async (c) => ...` — and
// Hono itself awaits the returned promise and dispatches errors through
// its `onError` middleware. The Express-shaped wrapper concern does not
// apply, so the rule must not flag single-arg async handlers on
// `.get/.post/.use/...` calls. The Express shape (`(req, res)` /
// `(req, res, next)`) still fires — see the negative fixture.

interface HonoContext {
  json(value: unknown, status?: number): Response;
  req: { valid(part: 'param'): Record<string, string> };
}

interface HonoApp {
  get(path: string, handler: (c: HonoContext) => Promise<Response>): void;
  use(path: string, handler: (c: HonoContext) => Promise<Response>): void;
}

declare const app: HonoApp;
declare const router: HonoApp;
declare const route: HonoApp;

declare function fetchDocument(id: string): Promise<{ payload: string }>;

app.get('/api/docs/:id', async (c) => {
  const { id } = c.req.valid('param');
  const doc = await fetchDocument(id);
  return c.json(doc);
});

router.use('/api/v2/*', async (c) => {
  const data = await fetchDocument('latest');
  return c.json(data);
});

route.get('/token/:token/data', async (c) => {
  const { token } = c.req.valid('param');
  const doc = await fetchDocument(token);
  return c.json(doc);
});
