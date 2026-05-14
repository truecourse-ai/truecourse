
declare const publicProcedure: { input: <T>(schema: T) => { mutation: <R>(handler: (opts: { input: unknown; ctx: unknown }) => Promise<R>) => unknown } };
declare const z: { object: (s: Record<string, unknown>) => unknown; string: () => unknown; array: (s: unknown) => unknown };

const archiveDocumentsProcedure = publicProcedure
  .input(z.object({ documentIds: z.array(z.string()) }))
  .mutation(async ({ input, ctx }) => {
    return { archivedCount: (input as { documentIds: string[] }).documentIds.length };
  });
