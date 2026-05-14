
// FF45 — createTRPCClient with typed router and links; standard tRPC client creation
declare function createTRPCClient<TRouter>(opts: {
  links: Array<unknown>;
}): { query: (path: string, input: unknown) => Promise<unknown> };
declare function splitLink(opts: {
  condition: (op: { type: string }) => boolean;
  true: unknown;
  false: unknown;
}): unknown;
declare function httpBatchLink(opts: { url: string }): unknown;
declare function wsLink(opts: { client: unknown }): unknown;
declare function createWSClient(opts: { url: string }): unknown;
interface AppRouter {}

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: createWSClient({ url: 'ws://localhost:3001' }) }),
      false: httpBatchLink({ url: '/api/trpc' }),
    }),
  ],
});
