export function selectById(table: string, id: string): string {
  return 'SELECT id, name, email FROM ' + table + ' WHERE id = $1 -- ' + id;
}
export function insertRecord(table: string, name: string, email: string): string {
  return 'INSERT INTO ' + table + ' (name, email) VALUES ($1, $2) -- ' + name + email;
}
export function deleteOld(table: string, olderThan: string): string {
  return 'DELETE FROM ' + table + ' WHERE created_at < $1 -- ' + olderThan;
}

// ---------------------------------------------------------------------------
// unvalidated-external-data — locals named body/data/payload that are NOT
// user input. Pre-fix the rule flagged any identifier with these names.
// ---------------------------------------------------------------------------

declare const cache: { get(key: string): Promise<unknown> };
declare const internalEvents: { read(): InternalEvent };
interface InternalEvent { kind: string; }
declare const Record: { insert(value: unknown): Promise<void> };

// Positive: local var named `data` initialized from cache (not from a request)
export async function syncFromCache(userId: string): Promise<void> {
  const data = await cache.get(userId);
  await Record.insert(data);
}

// Positive: local var named `body` initialized from a render call
export async function persistRenderedBody(): Promise<void> {
  const body = renderEmailBody();
  await Record.insert({ body });
}
function renderEmailBody(): string { return 'hello'; }

// Positive: local var named `payload` from an internal event reader
export async function persistInternalEventPayload(): Promise<void> {
  const event = internalEvents.read();
  const payload = { kind: event.kind, ts: Date.now() };
  await Record.insert(payload);
}



// ---------------------------------------------------------------------------
// unvalidated-external-data — tRPC-shaped positives mirroring documenso FPs.
// All DB writes receive values from validated/derived sources, never raw
// HTTP request fields. None of these should be flagged.
// ---------------------------------------------------------------------------

declare const prisma: {
  organisation: {
    findFirst(args: unknown): Promise<{ id: string; name: string }>;
    update(args: unknown): Promise<{ id: string }>;
    delete(args: unknown): Promise<{ id: string }>;
  };
  envelopeField: {
    findFirst(args: unknown): Promise<{ id: string; envelopeId: string }>;
    delete(args: unknown): Promise<{ id: string }>;
  };
  webhook: {
    create(args: unknown): Promise<{ id: string }>;
    findFirst(args: unknown): Promise<{ id: string }>;
  };
  envelopeItem: {
    findFirst(args: unknown): Promise<{ id: string; token: string }>;
  };
  auditLog: {
    create(args: unknown): Promise<{ id: string }>;
  };
};

declare const ZOrganisationUpdateSchema: { parse(value: unknown): { organisationId: string; name: string } };
declare const ZEnvelopeFieldDeleteSchema: { parse(value: unknown): { fieldId: string } };
declare const ZGetEnvelopeByTokenSchema: { parse(value: unknown): { token: string } };

type ProcedureCtx = { user: { id: string; email: string }; teamId: string };
type ProcedureHandler<I, R> = (args: { ctx: ProcedureCtx; input: I }) => Promise<R>;
type Procedure = {
  input<I>(schema: { parse(v: unknown): I }): {
    mutation<R>(fn: ProcedureHandler<I, R>): ProcedureHandler<I, R>;
    query<R>(fn: ProcedureHandler<I, R>): ProcedureHandler<I, R>;
  };
  mutation<R>(fn: (args: { ctx: ProcedureCtx }) => Promise<R>): (args: { ctx: ProcedureCtx }) => Promise<R>;
  query<R>(fn: (args: { ctx: ProcedureCtx }) => Promise<R>): (args: { ctx: ProcedureCtx }) => Promise<R>;
};
declare const authenticatedProcedure: Procedure;
declare const maybeAuthenticatedProcedure: Procedure;

// -- mode: trpc-zod-validated-input ----------------------------------------
// The handler binding `input` is the parsed Zod result, not raw request data.
export const updateOrganisationProcedure = authenticatedProcedure
  .input(ZOrganisationUpdateSchema)
  .mutation(async ({ input }) => {
    const updated = await prisma.organisation.update({
      where: { id: input.organisationId },
      data: { name: input.name },
    });
    return updated;
  });

// -- mode: db-values-from-server-fetched-objects ---------------------------
// Values written come from a prior server-fetched record, not from input.
export const deleteEnvelopeFieldProcedure = authenticatedProcedure
  .input(ZEnvelopeFieldDeleteSchema)
  .mutation(async ({ input }) => {
    const fieldToDelete = await prisma.envelopeField.findFirst({
      where: { id: input.fieldId },
    });
    const deletedField = await prisma.envelopeField.delete({
      where: { id: fieldToDelete.id },
    });
    await prisma.auditLog.create({
      data: { envelopeId: fieldToDelete.envelopeId, deletedFieldId: deletedField.id },
    });
    return deletedField;
  });

// -- mode: auth-context-only-no-user-input ---------------------------------
// No .input() chain; the only values used come from the authenticated ctx.
export const createOwnerWebhookProcedure = authenticatedProcedure.mutation(async ({ ctx }) => {
  const ownerEmail = ctx.user.email;
  const ownerTeam = ctx.teamId;
  const created = await prisma.webhook.create({
    data: { ownerId: ctx.user.id, ownerEmail, teamId: ownerTeam },
  });
  return created;
});

// -- mode: token-as-db-filter-not-stored-data ------------------------------
// Token is validated by Zod and used only as a read-side WHERE filter.
export const getEnvelopeItemsByTokenProcedure = maybeAuthenticatedProcedure
  .input(ZGetEnvelopeByTokenSchema)
  .query(async ({ input }) => {
    const item = await prisma.envelopeItem.findFirst({
      where: { token: input.token },
    });
    return item;
  });
