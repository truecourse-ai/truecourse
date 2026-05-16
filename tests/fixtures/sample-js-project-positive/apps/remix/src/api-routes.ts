
// Wave-M40: router.post('/', validator('json', schema), handler) — Hono route registration with validator middleware
declare function createValidator(format: 'json', schema: object): (c: unknown, next: () => Promise<void>) => Promise<void>;
declare const ZDetectRequestSchema: object;

declare class Router<TEnv = unknown> {
  post(path: string, ...handlers: Array<(c: unknown) => unknown>): this;
}

declare const jsonValidator: (c: unknown, next: () => Promise<void>) => Promise<void>;

const detectRoute = new Router().post(
  '/',
  createValidator('json', ZDetectRequestSchema),
  async (c) => ({ status: 200, body: {} }),
);
