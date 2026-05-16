
// D39: tRPC query with typed input object — no type mismatch
declare const trpc: {
  team: {
    member: {
      find: {
        useQuery(input: { teamId: string; search?: string; page?: number }): {
          data: TeamMemberResult[] | undefined;
          isLoading: boolean;
        };
      };
    };
  };
};

interface TeamMemberResult {
  id: string;
  userId: string;
  email: string;
  role: string;
}

export function useTeamMembers(teamId: string, search?: string) {
  return trpc.team.member.find.useQuery({ teamId, search, page: 1 });
}



// D45: tRPC procedure builder chain — correct fluent builder API, no type mismatch
declare const z: {
  object(shape: Record<string, unknown>): ZodSchema;
  string(): ZodSchema;
  number(): ZodSchema;
};

interface ZodSchema {
  optional(): ZodSchema;
  min(n: number): ZodSchema;
}

interface ProcedureBuilder {
  input(schema: ZodSchema): ProcedureBuilder;
  output(schema: ZodSchema): ProcedureBuilder;
  mutation<T>(handler: (opts: { input: unknown }) => Promise<T>): Procedure;
  query<T>(handler: (opts: { input: unknown }) => Promise<T>): Procedure;
}

interface Procedure {
  _type: 'procedure';
}

declare const procedure: ProcedureBuilder;

export const createEmbeddingDocumentProcedure = procedure
  .input(
    z.object({
      templateId: z.string(),
      title: z.string(),
      externalId: z.string().optional(),
    })
  )
  .output(
    z.object({
      documentId: z.number(),
    })
  )
  .mutation(async ({ input }) => {
    return { documentId: 42 };
  });



// G11: tRPC procedure builder chain meta/input/output/mutation — correct; no type mismatch
declare const authenticatedProcedure: {
  meta: (m: object) => typeof authenticatedProcedure;
  input: <T>(schema: T) => typeof authenticatedProcedure;
  output: <T>(schema: T) => typeof authenticatedProcedure;
  mutation: <T>(handler: (opts: { input: T; ctx: object }) => Promise<object>) => object;
};
declare const ZCreateDraftInputSchema: object;
declare const ZCreateDraftOutputSchema: object;

const createDraftProcedure = authenticatedProcedure
  .meta({ openapi: { method: 'POST', path: '/draft' } })
  .input(ZCreateDraftInputSchema)
  .output(ZCreateDraftOutputSchema)
  .mutation(async ({ input, ctx }) => {
    return { success: true };
  });



// G15: tRPC procedure builder input/mutation — correct; no type mismatch
declare const protectedProcedure: {
  input: <T>(schema: T) => { mutation: <U>(handler: (opts: { input: U; ctx: { userId: string } }) => Promise<object>) => object };
};
declare const ZUpdateProfileSchema: object;

const updateProfileMutation = protectedProcedure
  .input(ZUpdateProfileSchema)
  .mutation(async ({ input, ctx }) => {
    return { updated: true, userId: ctx.userId };
  });



// G16: standard tRPC procedure builder — no type mismatch
declare const baseProcedure: {
  input: <T>(schema: T) => { mutation: <U>(handler: (opts: { input: U }) => Promise<object>) => object };
};
declare const ZSubmitFeedbackSchema: object;

const submitFeedbackMutation = baseProcedure
  .input(ZSubmitFeedbackSchema)
  .mutation(async ({ input }) => {
    return { submitted: true };
  });



// FP shape 2dab38667d3a: tRPC procedure chain .meta().input().output().mutation() — correct usage
declare const baseProcedure: {
  meta: (meta: unknown) => typeof baseProcedure;
  input: (schema: unknown) => typeof baseProcedure;
  output: (schema: unknown) => typeof baseProcedure;
  mutation: (handler: (opts: { input: unknown }) => Promise<unknown>) => unknown;
};
declare const ZUpdateInput: unknown;
declare const ZUpdateOutput: unknown;

export const updateResourceMutation = baseProcedure
  .meta({ operationId: 'updateResource' })
  .input(ZUpdateInput)
  .output(ZUpdateOutput)
  .mutation(async ({ input }) => {
    void input;
    return { success: true };
  });
