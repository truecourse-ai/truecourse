
// Snippet: tRPC-style router call with correctly typed route objects
declare function createRouter<T extends Record<string, unknown>>(routes: T): T;
declare const listProjectsRoute: unknown;
declare const getProjectRoute: unknown;
declare const createProjectRoute: unknown;
declare const deleteProjectRoute: unknown;

export const projectRouter = createRouter({
  list: listProjectsRoute,
  get: getProjectRoute,
  create: createProjectRoute,
  delete: deleteProjectRoute,
});



// Shape 60a4d834955e: Discriminated union argument in router mutation.
declare const publicProcedure: { input: (s: unknown) => { mutation: (fn: unknown) => unknown } };
declare function z_object(shape: Record<string, unknown>): unknown;

const createFieldRoute = publicProcedure
  .input(z_object({ type: {} as unknown as 'TEXT' | 'SIGNATURE' }))
  .mutation(async ({ input }: { input: { type: 'TEXT' | 'SIGNATURE' } }) => {
    return { created: true, type: input.type };
  });

const updateFieldRoute = publicProcedure
  .input(z_object({ type: {} as unknown as 'TEXT' | 'SIGNATURE' }))
  .mutation(async ({ input }: { input: { type: 'TEXT' | 'SIGNATURE' } }) => {
    return { updated: true, type: input.type };
  });



// Shape 616f3fa3e62a: Typed route handler (Hono-style); no type mismatch.
interface AppContext { userId: string }
interface RouteHandler<C> { post(path: string, ...handlers: Array<(ctx: C) => Promise<unknown>>): RouteHandler<C> }
declare function createRouter<C>(): RouteHandler<C>;
declare function validateBody(schema: unknown): (ctx: AppContext) => Promise<void>;
declare const loginSchema: unknown;

const authRouter = createRouter<AppContext>()
  .post('/login', validateBody(loginSchema), async (ctx: AppContext) => {
    return { userId: ctx.userId };
  })
  .post('/logout', async (ctx: AppContext) => {
    return { loggedOut: true };
  })
  .post('/refresh', async (ctx: AppContext) => {
    return { refreshed: true };
  });



// Shape 61a8e68d6ae5: Typed router .post() chain with validator middleware and async handler.
interface GatewayContext { reqId: string }
interface GatewayRouter<C> { post(path: string, ...fns: Array<(ctx: C) => unknown>): GatewayRouter<C> }
declare function makeRouter<C>(): GatewayRouter<C>;
declare function sValidator(schema: unknown): (ctx: GatewayContext) => Promise<void>;
declare const authorizeSchema: unknown;

const passkeyRouter = makeRouter<GatewayContext>()
  .post('/authorize', sValidator(authorizeSchema), async (ctx: GatewayContext) => {
    return { authorized: true, reqId: ctx.reqId };
  });



// Shape 6387ca1432da: tRPC mutation with correct input schema.
declare const procedure: { input: (s: unknown) => { mutation: (fn: (opts: { input: { teamId: number; userId: number } }) => Promise<unknown>) => unknown } };
declare const teamMemberSchema: unknown;

const addTeamMember = procedure
  .input(teamMemberSchema)
  .mutation(async ({ input }: { input: { teamId: number; userId: number } }) => {
    return { added: true, teamId: input.teamId, userId: input.userId };
  });

const removeTeamMember = procedure
  .input(teamMemberSchema)
  .mutation(async ({ input }: { input: { teamId: number; userId: number } }) => {
    return { removed: true, teamId: input.teamId, userId: input.userId };
  });



// Shape 63fd15ebe89a: .all(path, async handler) forwarding c.req.raw (Request) to a handler that accepts Request.
interface HonoContext { req: { raw: Request } }
interface HonoApp { all(path: string, handler: (ctx: HonoContext) => Promise<unknown>): HonoApp }
declare const app: HonoApp;
declare function webhookHandler(req: Request): Promise<Response>;
declare function healthHandler(req: Request): Promise<Response>;

app
  .all('/webhooks/stripe', async (ctx) => webhookHandler(ctx.req.raw))
  .all('/health', async (ctx) => healthHandler(ctx.req.raw));



// --- shape dd433ef28284: tRPC .input().output().query() fluent chain ---
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { optional: () => unknown };
  number: () => unknown;
};
declare const publicProcedure: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      query: (handler: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
    };
  };
};

const getItemsByTokenRoute = publicProcedure
  .input(z.object({ token: z.string().optional(), resourceId: z.number() }))
  .output(z.object({ items: z.object({}) }))
  .query(async ({ input, ctx }) => {
    const { resourceId } = input as { resourceId: number; token?: string };
    return { items: { resourceId } };
  });



// --- shape df2a2ffb51e7: setDocumentRecipients({ userId, teamId, id, recipients }) ---
declare function setDocumentRecipients(opts: {
  userId: number;
  teamId: number;
  id: { type: string; id: number };
  recipients: Array<{ id: number; clientId: string; email: string; name: string; role: string }>;
  requestMetadata?: unknown;
}): Promise<void>;

declare const apiToken: { userId: number; teamId: number };
declare const resourceId: number;
declare const recipientsWithClientId: Array<{ id: number; clientId: string; email: string; name: string; role: string }>;
declare const requestMetadata: unknown;

await setDocumentRecipients({
  userId: apiToken.userId,
  teamId: apiToken.teamId,
  id: {
    type: 'envelopeId',
    id: resourceId,
  },
  recipients: recipientsWithClientId.map((recipient) => ({
    id: recipient.id,
    clientId: recipient.clientId,
    email: recipient.email,
    name: recipient.name,
    role: recipient.role,
  })),
  requestMetadata,
});
