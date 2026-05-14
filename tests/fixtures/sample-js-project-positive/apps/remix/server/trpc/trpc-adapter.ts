
// Snippet: createContext ignoring first arg by convention with _ placeholder
declare function buildContext(opts: { req: unknown; requestSource: string }): Promise<{ userId: string }>;
declare function createTrpcServer(opts: { router: unknown; createContext: (_: unknown, req: unknown) => Promise<unknown> }): unknown;
declare const appRouter: unknown;

export const trpcAdapter = createTrpcServer({
  router: appRouter,
  createContext: async (_, req) => buildContext({ req, requestSource: 'web' }),
});



// --- argument-type-mismatch FP: tRPC procedure .query() handler ---
declare const authenticatedProcedure: {
  query: <T>(handler: (opts: { ctx: { userId: number; orgId: number } }) => Promise<T>) => { _def: unknown };
};
declare function getSubscriptionPlans(userId: number): Promise<Array<{ id: string; name: string; price: number }>>;

const getPlansQuery = authenticatedProcedure.query(async ({ ctx }) => {
  return getSubscriptionPlans(ctx.userId);
});



// --- argument-type-mismatch FP: tRPC middleware definition ---
declare const t: {
  middleware: <T>(fn: (opts: { ctx: T; next: (opts?: { ctx?: Partial<T> }) => Promise<unknown>; path: string; meta?: unknown }) => Promise<unknown>) => unknown;
};

const loggingMiddleware = t.middleware(async ({ ctx, next, path, meta }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;
  console.log(`[tRPC] ${path} completed in ${durationMs}ms`);
  return result;
});



// Shape: createOpenApiFetchHandler<typeof router>() with config object — valid generic call, no type mismatch
declare function createOpenApiFetchHandler<TRouter>(config: {
  endpoint: string;
  router: TRouter;
  createContext: () => Promise<Record<string, unknown>>;
  req: Request;
  onError?: (opts: { error: unknown }) => void;
}): Promise<Response>;
declare const billingRouter: { _def: unknown };
declare const BILLING_API_URL: string;
declare function buildContext(): Promise<Record<string, unknown>>;
declare const request: Request;

export async function handleBillingOpenApiRequest() {
  return createOpenApiFetchHandler<typeof billingRouter>({
    endpoint: BILLING_API_URL,
    router: billingRouter,
    createContext: async () => buildContext(),
    req: request,
    onError: (opts) => console.error(opts.error),
  });
}



// Shape: router({...}) call defining a procedure router — valid tRPC router definition, no type mismatch
declare function router<T extends Record<string, unknown>>(procedures: T): T;
declare const listWorkflowsRoute: unknown;
declare const createWorkflowRoute: unknown;
declare const deleteWorkflowRoute: unknown;
declare const updateWorkflowRoute: unknown;

export const workflowRouter = router({
  list: listWorkflowsRoute,
  create: createWorkflowRoute,
  delete: deleteWorkflowRoute,
  update: updateWorkflowRoute,
});



// Shape: authenticatedProcedure.input(Z).output(Z) tRPC procedure builder chaining — no type mismatch
declare const authenticatedProcedure: {
  input: <T>(schema: T) => {
    output: <U>(schema: U) => {
      query: <V>(fn: (opts: { input: unknown; ctx: unknown }) => Promise<V>) => V;
    };
  };
};
declare const ZListWorkflowsRequestSchema: unknown;
declare const ZListWorkflowsResponseSchema: unknown;
declare function findWorkflows(opts: { userId: string; teamId: string }): Promise<unknown[]>;

export const listWorkflowsRoute = authenticatedProcedure
  .input(ZListWorkflowsRequestSchema)
  .output(ZListWorkflowsResponseSchema)
  .query(async ({ input, ctx }) => {
    return findWorkflows({ userId: (ctx as { user: { id: string } }).user.id, teamId: (ctx as { teamId: string }).teamId });
  });



// Shape: app.use(path, async (c) => handler(c, {...})) Hono middleware — standard pattern, types correct
declare const app: { use: (path: string, handler: (c: unknown) => Promise<unknown>) => void };
declare function openApiHandler(c: unknown, opts: { version: string; isBeta: boolean }): Promise<unknown>;

app.use('/api/v3/*', async (c) =>
  openApiHandler(c, {
    version: 'v3',
    isBeta: false,
  }),
);
