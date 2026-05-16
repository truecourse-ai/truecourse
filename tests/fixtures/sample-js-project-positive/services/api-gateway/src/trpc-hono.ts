
// shape: tRPC server createContext is async but delegates to createTrpcContext returning a Promise; async for tRPC createContext signature conformance
declare function createTrpcContext(opts: { c: unknown; requestSource: string }): Promise<Record<string, unknown>>;
declare const trpcServer: (opts: { router: unknown; endpoint: string; createContext: (opts: unknown, c: unknown) => Promise<unknown>; onError: (opts: unknown) => void }) => unknown;
declare const appRouter: unknown;
declare function handleTrpcError(opts: unknown, source: string): void;

const reactRouterTrpcServer = trpcServer({
  router: appRouter,
  endpoint: '/api/trpc',
  createContext: async (_, c) => createTrpcContext({ c, requestSource: 'app' }),
  onError: (opts) => handleTrpcError(opts, 'trpc'),
});
