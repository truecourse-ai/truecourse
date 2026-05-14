// tRPC-style fluent builder procedures (positive: correct Zod schema usage in typed methods)

declare const baseProcedure: {
  input: <T>(schema: T) => {
    output: <U>(schema: U) => {
      query: <V>(handler: V) => unknown;
      mutation: <V>(handler: V) => unknown;
      meta: <V>(data: V) => unknown;
    };
  };
};

declare const adminProcedure: {
  input: <T>(schema: T) => {
    output: <U>(schema: U) => {
      mutation: <V>(handler: V) => unknown;
      query: <V>(handler: V) => unknown;
    };
  };
};

declare const publicProcedure: {
  input: <T>(schema: T) => {
    query: <V>(handler: V) => unknown;
  };
};

declare const ZCreateUserSchema: unknown;
declare const ZUserResponseSchema: unknown;
declare const ZUpdateProfileSchema: unknown;
declare const ZProfileResponseSchema: unknown;
declare const ZDeleteAccountSchema: unknown;
declare const ZDeleteResponseSchema: unknown;
declare const ZListItemsSchema: unknown;
declare const ZItemsResponseSchema: unknown;
declare const ZGetStatsSchema: unknown;
declare const ZStatsResponseSchema: unknown;

export const createUserProcedure = adminProcedure
  .input(ZCreateUserSchema)
  .output(ZUserResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { name, email } = input;
    return { id: '123', name, email };
  });

export const updateProfileProcedure = baseProcedure
  .input(ZUpdateProfileSchema)
  .output(ZProfileResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { userId, bio } = input;
    return { success: true, bio };
  });

export const deleteAccountProcedure = adminProcedure
  .input(ZDeleteAccountSchema)
  .output(ZDeleteResponseSchema)
  .mutation(async ({ ctx, input }) => {
    const { accountId, reason } = input;
    return { deleted: true, accountId };
  });

export const listItemsProcedure = publicProcedure
  .input(ZListItemsSchema)
  .query(async ({ input }) => {
    const { page, limit } = input;
    return { items: [], total: 0 };
  });

export const getStatsProcedure = baseProcedure
  .input(ZGetStatsSchema)
  .output(ZStatsResponseSchema)
  .query(async ({ ctx, input }) => {
    const { period } = input;
    return { views: 100, clicks: 50 };
  });

export const archiveItemProcedure = baseProcedure
  .input(ZDeleteAccountSchema)
  .output(ZDeleteResponseSchema)
  .meta({ openapi: { method: 'POST', path: '/archive' } })
  .mutation(async ({ input }) => {
    return { archived: true };
  });
