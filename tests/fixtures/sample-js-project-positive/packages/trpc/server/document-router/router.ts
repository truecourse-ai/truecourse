// Two OpenAPI route definitions each specify their own tag array — per-router tag namespacing
declare function openApiRoute(config: { tags: string[]; method: string; path: string }): unknown;

const listDocumentsRoute = openApiRoute({
  tags: ['Documents'],
  method: 'GET',
  path: '/documents',
});

const createDocumentRoute = openApiRoute({
  tags: ['Documents'],
  method: 'POST',
  path: '/documents',
});


// procedure.input(ZSchema).output(ZSchema).mutation(...) — standard tRPC fluent builder chain, no argument-type-mismatch
declare const authenticatedProcedure: {
  input<T>(schema: T): { output<U>(schema: U): { mutation<V>(fn: (opts: { input: unknown; ctx: { user: { id: number }; logger: { info(data: unknown): void } } }) => Promise<V>): unknown } };
};
declare const ZCreateEnvelopeShareRequestSchema: unknown;
declare const ZCreateEnvelopeShareResponseSchema: unknown;

export const createEnvelopeShareRoute = authenticatedProcedure
  .input(ZCreateEnvelopeShareRequestSchema)
  .output(ZCreateEnvelopeShareResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { envelopeId } = input as { envelopeId: number };
    ctx.logger.info({ input: { envelopeId } });
    return { shareUrl: `/share/envelope/${envelopeId}` };
  });

