// FP shape: tRPC procedure builder chaining .meta().input().mutation() — no type mismatch
interface OpenApiMeta { method: string; path: string; summary: string; tags: string[] }
declare function z_object(shape: Record<string, unknown>): unknown;
declare const z: { object: typeof z_object; string: () => { optional: () => unknown } };
declare const authenticatedProcedure: {
  meta: (meta: { openapi: OpenApiMeta }) => {
    input: (schema: unknown) => {
      mutation: (handler: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
    };
  };
};

const updateProfileMutation = authenticatedProcedure
  .meta({
    openapi: {
      method: 'PATCH',
      path: '/profile',
      summary: 'Update user profile',
      tags: ['profile'],
    },
  })
  .input(z.object({ displayName: z.string().optional() }))
  .mutation(async ({ input, ctx }) => {
    return { success: true };
  });



// E22: conditional enum value passed to function — no type mismatch.
const enum AuditAction {
  SYSTEM_GENERATED = 'SYSTEM_GENERATED',
  USER_INITIATED = 'USER_INITIATED',
}

interface AuditLogPayload {
  action: AuditAction;
  resourceId: string;
}

declare function createAuditLogEntry(payload: AuditLogPayload): void;
declare const automationAgent: { id: string } | null;
declare const resourceFieldId: string;

createAuditLogEntry({
  action:
    automationAgent && resourceFieldId !== automationAgent.id
      ? AuditAction.SYSTEM_GENERATED
      : AuditAction.USER_INITIATED,
  resourceId: resourceFieldId,
});



// FP shape: tRPC procedure chain — authenticatedProcedure.input(ZSchema).mutation(async ({ input, ctx }) => {})
declare const z: { object: (shape: Record<string, unknown>) => unknown; string: () => unknown };
declare const ZUpdateUserProfileSchema: ReturnType<typeof z.object>;
declare const authenticatedProcedure: {
  input: (schema: unknown) => {
    mutation: (fn: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
  };
};

const updateUserProfile = authenticatedProcedure
  .input(ZUpdateUserProfileSchema)
  .mutation(async ({ input, ctx }) => {
    return { success: true, input, ctx };
  });



// FP shape: tRPC authenticatedProcedure.input(ZSchema).output(ZSchema).mutation() — standard builder chain
declare const z: { object: (shape: Record<string, unknown>) => unknown };
declare const ZUpdateSettingsInput: ReturnType<typeof z.object>;
declare const ZUpdateSettingsOutput: ReturnType<typeof z.object>;
declare const authenticatedProcedure: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: (fn: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
    };
  };
};

const updateSettings = authenticatedProcedure
  .input(ZUpdateSettingsInput)
  .output(ZUpdateSettingsOutput)
  .mutation(async ({ input, ctx }) => {
    return { updated: true, input, ctx };
  });



// FF27 — tRPC router() definition with nested route object; correctly typed
declare function createRouter<T extends Record<string, unknown>>(routes: T): T;
declare const findContactSuggestionsRoute: unknown;
declare const createContactRoute: unknown;

const contactRouter = createRouter({
  suggestions: {
    find: findContactSuggestionsRoute,
  },
  create: createContactRoute,
});
