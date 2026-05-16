
// FP shape: onError callback passing opts to handler with correct args; no type mismatch
declare function handleRouterError(opts: unknown, context: string): void;
declare function createApiRouter(opts: { onError: (opts: unknown) => void }): unknown;

const router = createApiRouter({
  onError: (opts) => handleRouterError(opts, 'apiV1'),
});



// ccb913aaa026: trpcServer({ router, endpoint }) adapter call with config object
declare function trpcServer(opts: { router: unknown; endpoint: string; createContext?: () => unknown }): unknown;
declare const apiRouter: unknown;

const trpcMiddleware = trpcServer({
  router: apiRouter,
  endpoint: '/api/trpc',
});
