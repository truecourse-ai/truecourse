
// --- argument-type-mismatch shape: tRPC procedure chain ---
// procedure.input(schema).query(async ({input, ctx}) => ...) — valid tRPC builder, no mismatch.
declare const z: { object: (s: object) => any; number: () => any; string: () => any };
declare const authenticatedProcedure: { input: (s: any) => { query: (fn: (args: any) => any) => any; mutation: (fn: (args: any) => any) => any } };
declare function findAuditLogs(opts: { userId: string; page: number }): Promise<unknown[]>;
const ZAuditLogsSchema = z.object({ page: z.number() });
const userRouter = {
  findAuditLogs: authenticatedProcedure
    .input(ZAuditLogsSchema)
    .query(async ({ input, ctx }: { input: { page: number }; ctx: { user: { id: string } } }) => {
      return await findAuditLogs({ userId: ctx.user.id, page: input.page });
    }),
};
