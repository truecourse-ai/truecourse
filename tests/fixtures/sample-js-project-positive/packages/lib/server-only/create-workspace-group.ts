
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { min: (n: number) => unknown; optional: () => unknown };
  array: (inner: unknown) => unknown;
  number: () => { int: () => unknown };
};
declare function authenticatedProcedure(): { input: (s: unknown) => { output: (s: unknown) => { mutation: (fn: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown } } };

const ZCreateWorkspaceGroupRequestSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  memberIds: z.array(z.number().int()).optional(),
});

const ZCreateWorkspaceGroupResponseSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
});

const createWorkspaceGroupRoute = authenticatedProcedure()
  .input(ZCreateWorkspaceGroupRequestSchema)
  .output(ZCreateWorkspaceGroupResponseSchema)
  .mutation(async ({ input, ctx }: { input: { workspaceId: string; name: string; memberIds?: number[] }; ctx: { user: { id: number } } }) => {
    const { workspaceId, name, memberIds } = input;
    return { id: 1, name };
  });
