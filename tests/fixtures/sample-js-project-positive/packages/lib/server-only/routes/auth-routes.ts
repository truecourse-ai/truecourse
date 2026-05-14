
// FF19 — Hono chained .post() with typed validator and async handler; no type mismatch
type HonoContext = { req: { valid(type: string): unknown }; json(body: unknown, status?: number): Response };
declare function sValidator(type: string, schema: unknown): (ctx: HonoContext, next: () => Promise<void>) => Promise<void>;
declare const ConfirmEmailSchema: unknown;
declare const apiRouter: {
  post(path: string, ...handlers: Array<(ctx: HonoContext, next?: () => Promise<void>) => Promise<Response> | Response | void>): typeof apiRouter;
};

apiRouter.post(
  '/confirm-email',
  sValidator('json', ConfirmEmailSchema),
  async (ctx) => {
    const body = ctx.req.valid('json') as { token: string };
    return ctx.json({ confirmed: true, token: body.token });
  }
);
