import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../middleware/auth';
export function catchTyped(): void {
  try { throw new Error('test'); } catch { logger.error('Caught an error'); }
}
export function parseInput(input: string): unknown {
  try { return JSON.parse(input) as unknown; } catch { throw new Error('Invalid JSON'); }
}
export function getAuth(): string { return `auth:${typeof authMiddleware}`; }
const FETCH_TIMEOUT_MS = 5000;
export async function syncReturnInTryCatch(url: string): Promise<Response> {
  try {
    const data = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return Response.json(data);
  } catch {
    return Response.json({ ok: false });
  }
}
export function doubleRaf(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
    });
  });
}
export function mapReturnInTryCatch(items: readonly string[]): string[] {
  try {
    return items.map((item) => item.toUpperCase());
  } catch {
    const empty: string[] = [];
    return empty;
  }
}
export function getFromCache(cache: { open: () => string }): string {
  try { return cache.open(); } catch { return ''; }
}
export function healthCheck(): string {
  try {
    // Check Redis/queue connection status
    return 'healthy';
  } catch {
    return 'unhealthy';
  }
}

// Positive: missing-null-check-after-find — find with optional chaining
export function safeFindAccess(items: ReadonlyArray<{ id: number; name: string }>, targetId: number): string {
  return items.find((i) => i.id === targetId)?.name ?? 'unknown';
}

// Positive: floating-promise — Map.delete is synchronous (not a promise)
export function cleanupMap(cache: Map<string, number>, key: string): void {
  cache.delete(key);
}



// Positive: missing-null-check-after-find — Konva's .find(selector) returns a Node array, never undefined
interface KonvaNode {
  id(): string;
  zIndex(): number;
}
interface KonvaContainer {
  find(selector: string): KonvaNode[];
  findOne(selector: string): KonvaNode | undefined;
}
declare const fieldGroup: KonvaContainer;
declare const pageLayer: { current: KonvaContainer | null };
declare const stage: KonvaContainer;
export function konvaFindSortRadioCircles(): KonvaNode[] {
  return fieldGroup.find('.radio-circle').sort((a, b) => a.zIndex() - b.zIndex());
}
export function konvaFindForEachGroups(): void {
  if (pageLayer.current == null) {
    return;
  }
  pageLayer.current.find('Group').forEach((node) => {
    void node.id();
  });
}
export function konvaFindFilterFieldGroups(): KonvaNode[] {
  return stage.find('.field-group').filter((node) => node.zIndex() > 0);
}



// Positive: promise-all-no-error-handling — trpc-framework-error-boundary.
// Promise.all inside a tRPC `.query()` handler; tRPC middleware converts unhandled
// rejections to TRPCError, but the analyzer only sees an awaited Promise.all with
// no local try/catch and no .catch() chain.
declare const prismaDb: {
  readonly user: {
    findMany: (args: { readonly where: { readonly teamId: number } }) => Promise<ReadonlyArray<{ readonly id: number }>>;
    count: (args: { readonly where: { readonly teamId: number } }) => Promise<number>;
  };
};

interface TrpcProcedureBuilder {
  input: <T>(schema: { readonly parse: (v: unknown) => T }) => TrpcProcedureBuilder;
  query: <TInput, TOutput>(handler: (opts: { readonly input: TInput }) => Promise<TOutput>) => unknown;
}

declare const adminProcedure: TrpcProcedureBuilder;
declare const zTeamMembersInput: { readonly parse: (v: unknown) => { readonly teamId: number } };

export const findTeamMembersProcedure = adminProcedure
  .input(zTeamMembersInput)
  .query(async ({ input }: { readonly input: { readonly teamId: number } }) => {
    const [members, total] = await Promise.all([
      prismaDb.user.findMany({ where: { teamId: input.teamId } }),
      prismaDb.user.count({ where: { teamId: input.teamId } }),
    ]);
    return { members, total };
  });

// Positive: promise-all-no-error-handling — job-runner-error-boundary.
// Promise.all inside the callback passed to `io.runTask`; the background-job
// framework catches rejections from the task callback, but the rule still flags
// the bare `await Promise.all(...)` since there is no local try/catch.
declare const sendEmail: (to: string, subject: string) => Promise<void>;
declare const recordAuditLog: (event: string, payload: unknown) => Promise<void>;

interface JobIo {
  runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

interface JobHandlerContext {
  readonly io: JobIo;
  readonly payload: { readonly documentId: string; readonly signerEmail: string };
}

export async function sendRecipientSignedEmailHandler(ctx: JobHandlerContext): Promise<void> {
  await ctx.io.runTask('send-signed-notification', async () => {
    await Promise.all([
      sendEmail(ctx.payload.signerEmail, 'Document signed'),
      recordAuditLog('document.signed', { documentId: ctx.payload.documentId }),
    ]);
  });
}

// Positive: promise-all-no-error-handling — prisma-transaction-rollback-boundary.
// Promise.all inside a `prisma.$transaction(async (tx) => { ... })` callback.
// Prisma rolls back the transaction atomically on rejection, but the analyzer
// sees only the bare `await Promise.all(...)` with no `try/catch`.
interface PrismaTransactionClient {
  readonly field: {
    create: (args: { readonly data: { readonly envelopeId: string; readonly key: string } }) => Promise<{ readonly id: string }>;
    update: (args: { readonly where: { readonly id: string }; readonly data: { readonly key: string } }) => Promise<{ readonly id: string }>;
    delete: (args: { readonly where: { readonly id: string } }) => Promise<{ readonly id: string }>;
  };
}

interface PrismaClientLike {
  $transaction: <T>(fn: (tx: PrismaTransactionClient) => Promise<T>) => Promise<T>;
}

declare const prismaClient: PrismaClientLike;

export async function setFieldsForEnvelope(
  envelopeId: string,
  toCreate: ReadonlyArray<{ readonly key: string }>,
  toUpdate: ReadonlyArray<{ readonly id: string; readonly key: string }>,
  toDelete: ReadonlyArray<{ readonly id: string }>,
): Promise<void> {
  await prismaClient.$transaction(async (tx) => {
    await Promise.all([
      ...toCreate.map((f) => tx.field.create({ data: { envelopeId, key: f.key } })),
      ...toUpdate.map((f) => tx.field.update({ where: { id: f.id }, data: { key: f.key } })),
      ...toDelete.map((f) => tx.field.delete({ where: { id: f.id } })),
    ]);
  });
}

// Positive: promise-all-no-error-handling — remix-nextjs-framework-error-boundary.
// Promise.all inside an exported Remix `loader` function. Remix's error boundary
// catches the rejection and renders an error route, but the rule does not model
// framework-level boundaries and flags the missing local try/catch.
declare const loadEnvelopeForRecipient: (token: string) => Promise<{ readonly id: string; readonly status: string }>;
declare const loadRecipientByToken: (token: string) => Promise<{ readonly id: string; readonly email: string }>;

interface RemixLoaderArgs {
  readonly params: { readonly token: string };
  readonly request: Request;
}

export async function loader({ params }: RemixLoaderArgs): Promise<{ envelope: { readonly id: string; readonly status: string }; recipient: { readonly id: string; readonly email: string } }> {
  const [envelope, recipient] = await Promise.all([
    loadEnvelopeForRecipient(params.token),
    loadRecipientByToken(params.token),
  ]);
  return { envelope, recipient };
}

// Positive: promise-all-no-error-handling — caller-provides-explicit-try-catch.
// `saveSignersData` runs `await Promise.all(...)` without a local try/catch,
// relying on every call site (`onAddSignersFormSubmit`) to wrap it. The rule
// only inspects the function body, so it still flags the bare Promise.all.
declare const upsertSigner: (signer: { readonly id: string; readonly email: string }) => Promise<void>;
declare const showErrorToast: (message: string) => void;

export async function saveSignersData(signers: ReadonlyArray<{ readonly id: string; readonly email: string }>): Promise<void> {
  await Promise.all(signers.map((signer) => upsertSigner(signer)));
}

export async function onAddSignersFormSubmit(signers: ReadonlyArray<{ readonly id: string; readonly email: string }>): Promise<void> {
  try {
    await saveSignersData(signers);
  } catch {
    showErrorToast('Failed to save signers');
  }
}



// Positive: unsafe-json-parse — JSON.parse(JSON.stringify(x)) deep-clone idiom of typed array
interface SampleField { id: number; type: string; value: string; }
declare const sampleFields: SampleField[];
export function cloneSampleFields(): SampleField[] {
  const clonedFields: SampleField[] = JSON.parse(JSON.stringify(sampleFields));
  return clonedFields;
}

// Positive: unsafe-json-parse — JSON.parse(JSON.stringify(x)) deep-clone idiom with `as` cast
interface SampleGroupOption { label: string; options: ReadonlyArray<{ value: string; label: string }>; }
declare const sampleGroupOption: SampleGroupOption;
export function cloneSampleGroupOption(): SampleGroupOption {
  const cloneOption = JSON.parse(JSON.stringify(sampleGroupOption)) as SampleGroupOption;
  return cloneOption;
}
