
// FP shape 02ae6ee06cc2: tRPC procedure.input().mutation() chaining — no type mismatch
declare const z: { object: (shape: object) => { parse: (v: unknown) => unknown }; string: () => unknown; number: () => unknown; };
declare const authenticatedProcedure: {
  input: (schema: unknown) => {
    mutation: (handler: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
  };
};

const ZUpdateProfileInput = z.object({ displayName: z.string(), avatarUrl: z.string() });

const updateProfileMutation = authenticatedProcedure
  .input(ZUpdateProfileInput)
  .mutation(async ({ input, ctx }) => {
    return { success: true };
  });



// FP shape 03805f3f68ea: tRPC .input().output() chaining — no type mismatch
declare const z: { object: (s: object) => unknown; string: () => unknown; number: () => unknown; };
declare const protectedProcedure: {
  input: (s: unknown) => {
    output: (s: unknown) => {
      query: (handler: (opts: unknown) => Promise<unknown>) => unknown;
    };
  };
};

const ZGetReportInput = z.object({ reportId: z.string() });
const ZGetReportOutput = z.object({ title: z.string(), createdAt: z.string() });

const getReportQuery = protectedProcedure
  .input(ZGetReportInput)
  .output(ZGetReportOutput)
  .query(async ({ input }) => {
    return { title: 'Monthly Report', createdAt: new Date().toISOString() };
  });



// FP shape 03e5a0f25229: tRPC useQuery with typed input object — no type mismatch
declare const trpc: {
  audit: {
    findSecurityEvents: {
      useQuery: (input: { page: number; pageSize: number; userId?: string }) => {
        data: unknown;
        isLoading: boolean;
      };
    };
  };
};

function useSecurityEventsPaginated(page: number) {
  return trpc.audit.findSecurityEvents.useQuery({
    page,
    pageSize: 20,
    userId: undefined,
  });
}



// FP shape 05f7ecab9854: tRPC procedure.query() with async callback — no type mismatch
interface UserCtx { user: { email: string; id: string } }
declare function getUserPreferences(opts: { email: string }): Promise<object>;
declare const authenticatedProcedure: {
  query: (handler: (opts: { ctx: UserCtx }) => Promise<unknown>) => unknown;
};

const getPreferencesQuery = authenticatedProcedure.query(async ({ ctx }) => {
  return await getUserPreferences({ email: ctx.user.email });
});



// FP shape: standard tRPC procedure.input() builder chain; no type mismatch
declare const z: { object: (s: Record<string, unknown>) => unknown; string: () => unknown };
declare const authenticatedProcedure: { input: (schema: unknown) => { mutation: (fn: unknown) => unknown } };
declare const ZRemoveMemberSchema: unknown;

export const removeMemberMutation = authenticatedProcedure
  .input(ZRemoveMemberSchema)
  .mutation(async ({ input, ctx }: { input: unknown; ctx: unknown }) => {
    return { success: true };
  });



// FP shape: tRPC procedure.input(schema).mutation(async fn); no type mismatch
declare const z: { object: (s: Record<string, unknown>) => unknown; string: () => unknown };
declare const procedure: { input: (s: unknown) => { mutation: (fn: (args: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown } };
declare const ZUpdateRecipientSchema: unknown;

export const updateRecipient = procedure
  .input(ZUpdateRecipientSchema)
  .mutation(async ({ input, ctx }) => {
    return { updated: true };
  });



// Snippet: tRPC authenticated procedure query handler
declare const authenticatedProcedure: { query: (fn: (opts: { ctx: { userId: number } }) => Promise<unknown>) => unknown };
declare function fetchUserNotifications(userId: number): Promise<Array<{ id: string; message: string }>>;

export const listNotificationsRoute = authenticatedProcedure.query(async ({ ctx }) => {
  return fetchUserNotifications(ctx.userId);
});



// --- FP shape: tRPC fluent builder chain .input().mutation() ---
declare const ZResendVerificationSchema: unknown;
declare const authenticatedProcedure: {
  input(schema: unknown): {
    mutation(fn: (opts: { input: unknown; ctx: unknown }) => Promise<void>): unknown;
  };
};

const resendVerification = authenticatedProcedure
  .input(ZResendVerificationSchema)
  .mutation(async ({ input, ctx }) => {
    void input;
    void ctx;
  });
