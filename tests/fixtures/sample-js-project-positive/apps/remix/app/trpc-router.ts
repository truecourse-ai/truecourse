// tRPC procedure.input().output().mutation() — standard tRPC procedure definition.
declare const publicProcedure: {
  input<S>(schema: S): {
    output<O>(schema: O): {
      mutation<R>(handler: (opts: { input: unknown; ctx: unknown }) => Promise<R>): unknown;
    };
  };
};

const createItemMutation = publicProcedure
  .input({ name: String, description: String })
  .output({ id: String, createdAt: String })
  .mutation(async ({ input }) => {
    return { id: 'new-id', createdAt: new Date().toISOString() };
  });
