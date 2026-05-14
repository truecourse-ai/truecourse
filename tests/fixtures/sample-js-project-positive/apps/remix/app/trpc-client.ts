// tRPC splitLink inside createClient — standard tRPC React provider setup.
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const trpc: {
  createClient(opts: { links: unknown[] }): unknown;
};
declare function splitLink(opts: {
  condition(op: { context: Record<string, unknown>; input: unknown }): boolean;
  true: unknown;
  false: unknown;
}): unknown;
declare function httpLink(opts: { url: string; headers: Record<string, string> }): unknown;
declare function httpBatchLink(opts: { url: string; headers: Record<string, string> }): unknown;

function useApiClient(headers: Record<string, string>) {
  const client = useMemo(
    () =>
      trpc.createClient({
        links: [
          splitLink({
            condition: (op) => op.context['skipBatch'] === true,
            true: httpLink({ url: '/api/trpc', headers }),
            false: httpBatchLink({ url: '/api/trpc', headers }),
          }),
        ],
      }),
    [headers],
  );
  return client;
}
