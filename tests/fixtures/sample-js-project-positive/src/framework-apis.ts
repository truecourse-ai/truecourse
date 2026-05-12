/**
 * Framework API patterns that should NOT trigger any rules.
 *
 * Star imports for React are idiomatic.
 * Relative namespace imports are allowed.
 * parseInt with radix argument satisfies the missing-radix rule.
 * Drizzle style eq function calls.
 */

import * as React from 'react';
import * as helpers from './helpers';

export function parsePageNumber(input: string): number {
  return parseInt(input, 10);
}

export function parseHexColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

interface Column {
  name: string;
}

interface WhereClause {
  column: Column;
  value: string;
}

function eq(column: Column, value: string): WhereClause {
  return { column, value };
}

export function buildQuery(userId: string): WhereClause {
  const usersTable = { id: { name: 'id' } };
  return eq(usersTable.id, userId);
}

export function getReactVersion(): unknown {
  return React;
}

export function getHelperCount(): number {
  return Object.keys(helpers).length;
}



/**
 * Framework-invoked object-literal callbacks.
 *
 * `handler` is a required field of the `JobDefinition` contract — the
 * job-scheduler framework invokes it at runtime via the registry. There is
 * no direct call-site in source, but it is not dead.
 *
 * `headers` is a required callback parameter of tRPC's `httpBatchLink`
 * config. tRPC invokes it on every outgoing request to populate HTTP
 * headers. No userland call-site exists; it is a framework contract.
 */
interface JobDefinition<TPayload> {
  readonly id: string;
  readonly name: string;
  readonly trigger: { readonly events: readonly string[] };
  readonly handler: (ctx: { readonly payload: TPayload }) => Promise<void>;
}

declare const jobs: { register: <T>(def: JobDefinition<T>) => void };

export const SEND_DOCUMENT_CANCELLED_JOB: JobDefinition<{ readonly documentId: string }> = {
  id: 'send.document.cancelled.emails',
  name: 'Send Document Cancelled Emails',
  trigger: { events: ['document.cancelled'] },
  handler: async ({ payload }) => {
    await Promise.resolve();
    void payload.documentId;
  },
};

jobs.register(SEND_DOCUMENT_CANCELLED_JOB);

declare const httpBatchLink: (config: {
  readonly url: string;
  readonly headers: () => Record<string, string>;
}) => unknown;

export const trpcClientLink = httpBatchLink({
  url: '/api/trpc',
  headers: () => ({ 'x-source': 'web', 'x-trpc-source': 'react' }),
});

/**
 * Abstract base-class template method.
 *
 * `BaseJobProvider.defineJob` has a 'must override' guard body. Concrete
 * subclasses (`LocalJobProvider`) override it; the application calls it
 * polymorphically through the base reference. The throw body is the
 * documented override contract, not dead code.
 */
export abstract class BaseJobProvider {
  defineJob(_definition: { readonly id: string }): void {
    throw new Error('defineJob must be implemented by the concrete provider');
  }

  getApiHandler(): (req: unknown) => Promise<unknown> {
    throw new Error('getApiHandler must be implemented by the concrete provider');
  }
}

export class LocalJobProvider extends BaseJobProvider {
  private readonly registry = new Map<string, { readonly id: string }>();

  override defineJob(definition: { readonly id: string }): void {
    this.registry.set(definition.id, definition);
  }

  override getApiHandler(): (req: unknown) => Promise<unknown> {
    return async (req) => ({ ok: true, req });
  }
}

export function bootstrapJobs(provider: BaseJobProvider, ids: readonly string[]): void {
  for (const id of ids) {
    provider.defineJob({ id });
  }
}

/**
 * Interface-contract implementation.
 *
 * `JsonTransformer` implements the `DataTransformer` interface (a tRPC
 * type contract). `serialize` and `deserialize` are invoked by tRPC
 * internals on every request/response. No direct userland call-site
 * exists, but they are required interface implementations, not dead.
 */
interface DataTransformer {
  serialize(value: unknown): string;
  deserialize(value: string): unknown;
}

export class JsonTransformer implements DataTransformer {
  serialize(value: unknown): string {
    return JSON.stringify(value);
  }

  deserialize(value: string): unknown {
    return JSON.parse(value) as unknown;
  }
}

declare const initTRPC: {
  create: (opts: { readonly transformer: DataTransformer }) => unknown;
};

export const trpcRouter = initTRPC.create({ transformer: new JsonTransformer() });

/**
 * Interop-adapter getter/setter.
 *
 * The mock `ServerResponse`-shaped object bridges Node HTTP and the Fetch
 * API. `openApiHttpHandler` reads/writes `statusCode` through these
 * accessors to record the HTTP status before the Response is resolved.
 * They are required interop glue, not dead methods.
 */
declare const openApiHttpHandler: (req: unknown, res: {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}) => void;

export function handleOpenApiRequest(request: { readonly url: string }): Promise<Response> {
  return new Promise((resolve) => {
    let recordedStatus = 200;
    const headers: Record<string, string> = {};
    const chunks: string[] = [];

    const mockRes = {
      get statusCode(): number {
        return recordedStatus;
      },
      set statusCode(value: number) {
        recordedStatus = value;
      },
      setHeader(name: string, value: string): void {
        headers[name] = value;
      },
      end(body?: string): void {
        if (body !== undefined) chunks.push(body);
        resolve(new Response(chunks.join(''), { status: recordedStatus, headers }));
      },
    };

    openApiHttpHandler(request, mockRes);
  });
}


// raw-error-in-response: sanitized-error-response mode.
// Catch block returns only a controlled string message (AppError.message or hardcoded
// fallback), never the raw error object. Pattern mirrors apps/remix/server/api/ai/
// detect-fields.ts where the response body exposes a safe message only.
declare const detectFieldsRequest: { body: unknown };
declare const detectFieldsService: { run: (body: unknown) => Promise<{ fields: string[] }> };
class AppError extends Error {
  public readonly code: string;
  constructor(code: string, opts: { message: string }) {
    super(opts.message);
    this.code = code;
  }
}
export async function detectFieldsRoute(): Promise<Response> {
  try {
    const result = await detectFieldsService.run(detectFieldsRequest.body);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Failed to detect fields';
    return new Response(JSON.stringify({ message }), { status: 500 });
  }
}

// raw-error-in-response: non-http-context mode.
// Background-job handler accumulates err.message into an internal results array that
// is later emailed to the triggering user. No Response/json() call in the catch block;
// the error detail never reaches an HTTP API response body.
declare const templateRows: ReadonlyArray<{ id: string; payload: unknown }>;
declare const sendBulkRow: (row: { id: string; payload: unknown }) => Promise<void>;
declare const emailJobSummary: (results: ReadonlyArray<{ id: string; error?: string }>) => Promise<void>;
export async function bulkSendTemplateHandler(): Promise<void> {
  const results: Array<{ id: string; error?: string }> = [];
  for (const row of templateRows) {
    try {
      await sendBulkRow(row);
      results.push({ id: row.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      results.push({ id: row.id, error: message });
    }
  }
  await emailJobSummary(results);
}

// raw-error-in-response: error-rethrown-no-response mode.
// Catch block logs with console.error then re-throws as a new AppError. No HTTP
// response is constructed here; the error propagates to the outer framework handler.
declare const oauthCallbackParams: { code: string; state: string };
declare const exchangeOAuthCode: (code: string, state: string) => Promise<{ userId: string }>;
export async function oauthCallbackRoute(): Promise<{ userId: string }> {
  try {
    return await exchangeOAuthCode(oauthCallbackParams.code, oauthCallbackParams.state);
  } catch (err) {
    console.error('OAuth callback failed', err);
    if (err instanceof Error) {
      throw new AppError(err.name, { message: err.message });
    }
    throw err;
  }
}

// raw-error-in-response: client-side-code mode.
// Error is passed to a React useState setter for UI display; no HTTP response object.
// Mirrors apps/remix/app/routes/embed+/playground.tsx setTokenError pattern.
declare const useState: <T>(initial: T) => [T, (next: T) => void];
declare const decodeEmbedToken: (token: string) => Promise<{ envelopeId: string }>;
export function EmbedPlaygroundController(): { submit: (token: string) => Promise<void> } {
  const [, setTokenError] = useState<string | null>(null);
  return {
    async submit(token: string): Promise<void> {
      try {
        await decodeEmbedToken(token);
        setTokenError(null);
      } catch (error) {
        setTokenError(error instanceof Error ? error.message : 'Invalid token');
      }
    },
  };
}



// --- route-without-auth-middleware: positive (no-violation) patterns ---

declare const app: {
  use: (path: string, ...handlers: unknown[]) => void;
  get: (path: string, ...handlers: unknown[]) => void;
  post: (path: string, ...handlers: unknown[]) => void;
};
declare const corsMiddleware: () => unknown;
declare const aiRateLimitMiddleware: unknown;
declare const requestLoggerMiddleware: (c: unknown, next: () => Promise<void>) => Promise<void>;
declare const openApiTrpcServerHandler: (c: unknown) => Response;
declare const openApiDocument: Record<string, unknown>;
declare const getOptionalSession: (c: { req: { header: (n: string) => string | undefined } }) => Promise<{ userId: string | null }>;
declare const verifyEmbeddingPresignToken: (token: string) => Promise<boolean>;
declare const checkEnvelopeFileAccess: (userId: string, envelopeId: string) => Promise<boolean>;
declare const findRecipientByToken: (token: string) => Promise<{ id: string; envelopeId: string } | null>;

// Mode: middleware-call-misidentified-as-route
// app.use() registers middleware (CORS, rate-limiting, logging), not routes.
app.use('/api/v2/*', corsMiddleware());
app.use('/api/ai/*', aiRateLimitMiddleware);
app.use(async (c, next) => {
  await requestLoggerMiddleware(c, next);
});

// Mode: auth-inside-framework-dispatcher
// Route delegates to a tRPC dispatcher; auth lives inside the procedure chain.
app.all('/api/v2/*' as unknown as string, (c: unknown) => openApiTrpcServerHandler(c));
app.all('/api/v2-beta/*' as unknown as string, (c: unknown) => openApiTrpcServerHandler(c));

// Mode: public-api-documentation-endpoint
// Routes intentionally serve OpenAPI spec publicly (no auth needed).
app.get('/api/v2/openapi.json', () => Response.json(openApiDocument));
app.get('/api/v2-beta/openapi.json', () => Response.json(openApiDocument));

// Mode: inline-auth-check-in-handler
// Route enforces auth inline via session helper + access check.
app.get('/api/files/envelope/:envelopeId/pdf', async (c: { req: { param: (n: string) => string; header: (n: string) => string | undefined } }) => {
  const session = await getOptionalSession(c);
  if (!session.userId) {
    return new Response('Not found', { status: 404 });
  }
  const envelopeId = c.req.param('envelopeId');
  const allowed = await checkEnvelopeFileAccess(session.userId, envelopeId);
  if (!allowed) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response('pdf-bytes');
});

// Mode: token-in-path-auth-pattern
// URL-embedded token is validated against the DB inside the handler.
app.get('/api/files/envelope/:envelopeId/pdf/by-token/:token', async (c: { req: { param: (n: string) => string } }) => {
  const token = c.req.param('token');
  const recipient = await findRecipientByToken(token);
  if (!recipient) {
    return new Response('Not found', { status: 404 });
  }
  const presignOk = await verifyEmbeddingPresignToken(token);
  if (!presignOk) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response('pdf-bytes');
});


// --- argument-type-mismatch FP patterns ---

// stdlib-and-third-party-api-calls: filter that drops nulls is sound at runtime
// even though TS does not narrow without a type predicate.
export function collectCheckedIndices(values: ReadonlyArray<{ checked: boolean }>): (number | null)[] {
  return values.map((value, i) => (value.checked ? i : null)).filter((value) => value !== null);
}

// react-ui-framework-apis: shadcn/Radix forwardRef boilerplate with generic args.
declare const ReactNs: {
  forwardRef<T, P>(render: (props: P, ref: { current: T | null }) => unknown): (props: P) => unknown;
  ElementRef: unknown;
  ComponentPropsWithoutRef: unknown;
};
declare const AccordionPrimitiveContent: { displayName: string };
type ContentRef = typeof AccordionPrimitiveContent;
type ContentProps = { className?: string; children?: unknown };
export const AccordionContent = ReactNs.forwardRef<ContentRef, ContentProps>(
  ({ className, children }, ref) => ({ className, children, ref }),
);

// trpc-fluent-builder-chain: procedure.input(...).output(...).mutation(...).
declare const adminProcedure: {
  input<I>(schema: I): {
    output<O>(schema: O): {
      mutation<R>(handler: (ctx: { input: I; output: O }) => R): { run: () => R };
    };
  };
};
declare const ZCreateAdminOrganisationRequestSchema: { _input: { name: string } };
declare const ZCreateAdminOrganisationResponseSchema: { _output: { id: string } };
export const createAdminOrganisationRoute = adminProcedure
  .input(ZCreateAdminOrganisationRequestSchema)
  .output(ZCreateAdminOrganisationResponseSchema)
  .mutation(({ input, output }) => ({ input, output }));

// orm-query-builder-apis: Kysely .select(({ fn }) => [...]) callback.
type KyselyExprBuilder = {
  fn: {
    <R>(name: string, args: ReadonlyArray<unknown>): { as(alias: string): { __r: R; alias: string } };
    count<R>(column: string): { as(alias: string): { __r: R; alias: string } };
  };
};
type KyselySelectQuery = {
  select(
    cb: (eb: KyselyExprBuilder) => ReadonlyArray<{ alias: string }>,
  ): { execute(): Promise<ReadonlyArray<Record<string, unknown>>> };
};
declare const kyselyPrisma: { $kysely: { selectFrom(table: string): KyselySelectQuery } };
declare const sqlLit: (literal: string) => unknown;
export const usersStatsQuery = kyselyPrisma.$kysely
  .selectFrom('UserSecurityAuditLog')
  .select(({ fn }) => [
    fn<Date>('DATE_TRUNC', [sqlLit('MONTH'), 'Envelope.updatedAt']).as('month'),
    fn.count<number>('id').as('count'),
  ]);

// ts-pattern-match-with: match(...).with(literal, handler).exhaustive().
declare const matchFn: <T>(value: T) => {
  with<L extends T, R>(literal: L, handler: (v: L) => R): {
    with<L2 extends T, R2>(literal: L2, handler: (v: L2) => R2): {
      exhaustive(): R | R2;
    };
    exhaustive(): R;
  };
};
type FieldKind = 'SIGNATURE' | 'TEXT';
declare const currentFieldType: FieldKind;
export const renderedField = matchFn(currentFieldType)
  .with('SIGNATURE', () => ({ kind: 'signature' as const }))
  .with('TEXT', () => ({ kind: 'text' as const }))
  .exhaustive();


// Await-in-loop false-positive patterns from real codebases.

// intra-iteration-data-dependency: find-or-create pattern where the awaited
// findFirst result determines whether to call create in the same iteration.
declare const prisma: {
  user: {
    findFirst: (args: { where: { email: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: { email: string } }) => Promise<{ id: string }>;
  };
};
declare const seedEmails: string[];
export async function seedUsers(): Promise<void> {
  for (const email of seedEmails) {
    const existing = await prisma.user.findFirst({ where: { email } });
    if (!existing) {
      await prisma.user.create({ data: { email } });
    }
  }
}

// seed-and-test-infrastructure: sequential seed runner where later seeds
// depend on data created by earlier ones.
declare const seedRunners: Array<() => Promise<void>>;
export async function runSeeds(): Promise<void> {
  for (const runSeed of seedRunners) {
    await runSeed();
  }
}

// shared-mutable-state-or-ordered-protocol: pdf-lib mutates a single shared
// PDFDocument; pages must be embedded in order.
declare const pdfDoc: {
  embedPage: (page: unknown) => Promise<{ width: number; height: number }>;
};
declare const sourcePages: unknown[];
export async function embedAllPages(): Promise<Array<{ width: number; height: number }>> {
  const embedded: Array<{ width: number; height: number }> = [];
  for (const page of sourcePages) {
    const ref = await pdfDoc.embedPage(page);
    embedded.push(ref);
  }
  return embedded;
}

// framework-enforced-serial-dispatch: io.runTask is a workflow-orchestration
// SDK call that requires serial dispatch for idempotency/checkpointing.
declare const io: {
  runTask: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
};
declare const members: Array<{ id: string; email: string }>;
declare const sendJoinedEmail: (member: { id: string; email: string }) => Promise<void>;
export async function dispatchJoinedEmails(): Promise<void> {
  for (const member of members) {
    await io.runTask(`send-joined-${member.id}`, async () => {
      await sendJoinedEmail(member);
    });
  }
}

// early-exit-or-cross-iteration-accumulation: HOTP window validation that
// generates codes for successive time windows and returns early on match.
declare const generateHOTP: (secret: string, counter: number) => Promise<string>;
export async function validateTotpWindow(
  secret: string,
  code: string,
  counter: number,
  window: number,
): Promise<boolean> {
  for (let i = counter - window; i <= counter + window; i++) {
    const hotp = await generateHOTP(secret, i);
    if (code === hotp) {
      return true;
    }
  }
  return false;
}



// Remix loader returning a discriminated union shape based on access validity.
// The component narrows on the `isDocumentAccessValid` discriminant.
declare const getOptionalSessionUser: (request: Request) => Promise<{ email: string } | null>;
declare const getDocumentForRecipient: (token: string) => Promise<{ id: string; status: string; recipientEmail: string; documentData: { url: string } } | null>;

export async function recipientCompleteLoader(args: { request: Request; params: { token: string } }) {
  const { request, params } = args;
  const user = await getOptionalSessionUser(request);
  const document = await getDocumentForRecipient(params.token);

  if (!document) {
    return { isDocumentAccessValid: false as const, recipientEmail: user?.email ?? null };
  }

  if (user && user.email !== document.recipientEmail) {
    return { isDocumentAccessValid: false as const, recipientEmail: document.recipientEmail };
  }

  return {
    isDocumentAccessValid: true as const,
    document,
    recipientEmail: document.recipientEmail,
    documentData: document.documentData,
  };
}

// Remix loader returning a state-tagged discriminated union via `as const`.
declare const findOrganisationInviteByToken: (token: string) => Promise<{ organisationName: string; inviterEmail: string } | null>;

export async function organisationDeclineLoader(args: { params: { token: string } }) {
  const { token } = args.params;

  if (!token) {
    return { state: 'InvalidLink' } as const;
  }

  const invite = await findOrganisationInviteByToken(token);

  if (!invite) {
    return { state: 'InvalidLink' } as const;
  }

  return {
    state: 'Success',
    organisationName: invite.organisationName,
    inviterEmail: invite.inviterEmail,
  } as const;
}

// Async helper that returns Headers|undefined as a sentinel for "no CORS headers needed".
// Callers explicitly check for undefined; this is a standard T|undefined idiom.
type StaticOrigin = boolean | string | RegExp | (string | RegExp)[];
type OriginFn = (origin: string | undefined, req: Request) => StaticOrigin | Promise<StaticOrigin>;

export async function originHeadersFromReq(req: Request, origin: StaticOrigin | OriginFn): Promise<Headers | undefined> {
  const reqOrigin = req.headers.get('Origin') || undefined;
  const value = typeof origin === 'function' ? await origin(reqOrigin, req) : origin;

  if (!value) {
    return undefined;
  }

  const headers = new Headers();
  if (value === true) {
    headers.set('Access-Control-Allow-Origin', reqOrigin ?? '*');
    return headers;
  }

  if (typeof value === 'string') {
    headers.set('Access-Control-Allow-Origin', value);
    return headers;
  }

  return undefined;
}


// FP: generic toast title paired with specific actionable description
declare const toast: (opts: { title: string; description: string; variant?: string; duration?: number }) => void;
declare const _: (msg: { message: string }) => string;
declare const msg: (strings: TemplateStringsArray) => { message: string };

export function notifyTeamEmailDeleteFailure(): void {
  toast({
    title: _(msg`Something went wrong`),
    description: _(msg`Unable to remove team email at this time. Please try again.`),
    variant: 'destructive',
    duration: 10000,
  });
}

export function notifyDirectTemplateSubmitFailure(): void {
  toast({
    title: 'Something went wrong',
    description: 'We were unable to submit this document at this time. Please try again later.',
    variant: 'destructive',
  });
}

// FP: server-side 500 catch-all that intentionally hides internals
declare const AppErrorCode: { INVALID_BODY: 'INVALID_BODY'; UNAUTHORIZED: 'UNAUTHORIZED'; NOT_FOUND: 'NOT_FOUND' };
declare const parseAppError: (err: unknown) => { code: string; message: string };

export function toRestApiError(err: unknown): { status: number; body: { message: string } } {
  const error = parseAppError(err);

  let status: number;
  if (error.code === AppErrorCode.INVALID_BODY) {
    status = 400;
  } else if (error.code === AppErrorCode.UNAUTHORIZED) {
    status = 401;
  } else if (error.code === AppErrorCode.NOT_FOUND) {
    status = 404;
  } else {
    status = 500;
  }

  return {
    status,
    body: {
      message: status !== 500 ? error.message : 'Something went wrong',
    },
  };
}

declare const logger: { error: (e: unknown) => void };
declare const c: { json: (body: unknown, status: number) => Response };
class AppError extends Error { code = 'UNKNOWN'; }

export async function handleFileRequest(): Promise<Response> {
  try {
    return c.json({ ok: true }, 200);
  } catch (error) {
    logger.error(error);

    if (error instanceof AppError) {
      return c.json({ error: error.message, code: error.code }, 400);
    }

    return c.json({ error: 'Internal server error' }, 500);
  }
}


// Hono c.json() returns a synchronous Response. Early-return guards inside try
// blocks intentionally omit await — the value is not a Promise.
declare const honoCtx: {
  json: <T>(body: T, status?: number) => Response;
  req: { param: (key: string) => string };
};
declare const findEnvelopeItem: (id: string) => Promise<{ id: string } | null>;

export async function downloadEnvelopeItem(): Promise<Response> {
  try {
    const id = honoCtx.req.param('id');
    const item = await findEnvelopeItem(id);
    if (!item) {
      return honoCtx.json({ error: 'Envelope item not found' }, 404);
    }
    return honoCtx.json({ id: item.id });
  } catch (error) {
    return honoCtx.json({ error: 'Internal error' }, 500);
  }
}

// hono/streaming streamText is a sync utility that returns a Response object,
// not a Promise. Returning without await is the documented pattern.
declare const streamText: (
  c: typeof honoCtx,
  cb: (stream: { write: (chunk: string) => Promise<void> }) => Promise<void>,
) => Response;
declare const detectFields: (text: string) => AsyncIterable<string>;

export function detectFieldsRoute(): Response {
  return streamText(honoCtx, async (stream) => {
    const interval: ReturnType<typeof setInterval> | null = setInterval(() => {
      void stream.write(':keepalive\n');
    }, 15_000);
    try {
      for await (const chunk of detectFields('hello')) {
        await stream.write(chunk);
      }
    } finally {
      if (interval) clearInterval(interval);
    }
  });
}

// c.json() is a synchronous Response builder. The async work is already awaited
// on the line above, so the final return needs no await.
declare const createPresignedPostUrl: (
  filename: string,
) => Promise<{ key: string; url: string }>;

export async function getPresignedPostUrl(): Promise<Response> {
  const { key, url } = await createPresignedPostUrl('upload.pdf');
  return honoCtx.json({ key, url });
}



// Top-level polyfill patching a third-party class so a runtime brand check
// (`Object.prototype.toString.call(path) === '[object Path2D]'`) used by the
// skia-canvas backend recognises Path2D instances. This is a module-init
// shim, not a class-context mutation - it must not trigger the
// class-prototype-assignment determinism rule.
declare class Path2D {
  addPath(path: Path2D): void;
}

Path2D.prototype.toString = () => '[object Path2D]';



/**
 * Deprecated-API-usage declaration sites that must NOT trigger the rule.
 *
 * The rule should fire on call-sites consuming a deprecated API, not on the
 * declaration that carries the @deprecated tag itself. We also model the
 * documenso hash.ts case: importing non-deprecated symbols from a module
 * that happens to re-export some deprecated wrappers is not a deprecated usage.
 */

declare const readEnvFlag: (key: string) => string;
declare const compareSyncImpl: (plaintext: string, hash: string) => boolean;
declare const hashSyncImpl: (plaintext: string, rounds: number) => string;
declare const authenticatedProcedure: {
  input: <T>(schema: T) => {
    mutation: (handler: (...args: readonly unknown[]) => Promise<unknown>) => unknown;
  };
};
declare const ZCreateDocumentTemporaryRequestSchema: { _type: 'schema' };

/**
 * @deprecated Use the playwright-backed renderer service instead.
 */
export const NEXT_PRIVATE_USE_PLAYWRIGHT_PDF = (): boolean =>
  readEnvFlag('NEXT_PRIVATE_USE_PLAYWRIGHT_PDF') === 'true';

export const compareSync = (plaintext: string, hash: string): boolean =>
  compareSyncImpl(plaintext, hash);

/**
 * @deprecated Use {@link hash} instead. The synchronous wrapper blocks the event loop.
 */
export const hashSync = (plaintext: string, rounds = 12): string =>
  hashSyncImpl(plaintext, rounds);

/**
 * @deprecated Replaced by createDocumentV2Route. Retained for legacy clients.
 */
export const createDocumentTemporaryRoute = authenticatedProcedure
  .input(ZCreateDocumentTemporaryRequestSchema)
  .mutation(async () => ({ ok: true }));



// --- magic-string positive cases (no violations expected) ---

// Mode: typed-discriminant-union
// A discriminated union tag and a typed UI variant prop literal that matches
// a declared union type. Not a loose magic string.
type BannerVariant = 'default' | 'destructive' | 'success';
type BannerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; payload: string };

export function renderBannerProps(state: BannerState): { variant: BannerVariant; kind: BannerState['kind'] } {
  if (state.kind === 'ready') {
    return { variant: 'destructive', kind: state.kind };
  }
  return { variant: 'default', kind: state.kind };
}

// Mode: framework-library-api
// Idiomatic web platform call where the literal is a required key
// argument to a typed framework API (URLSearchParams / form field name).
declare const searchParams: URLSearchParams;
declare const formApi: {
  getValues<K extends string>(name: K): string | undefined;
  setError(name: string, message: { type: string; message: string }): void;
};

export function readQueryAndField(): { query: string | null; email: string | undefined } {
  const query = searchParams.get('query');
  const email = formApi.getValues('email');
  formApi.setError('email', { type: 'manual', message: 'required' });
  return { query, email };
}

// Mode: web-protocol-standard
// HTTP method names, HTTP reason phrases, header names, typeof primitives,
// and Node Buffer encodings are platform constants, not domain magic strings.
declare const fetchFn: (url: string, init: { method: string; headers: Record<string, string> }) => Promise<Response>;
declare const BufferLike: { from(input: string, encoding: 'base64' | 'utf-8' | 'hex'): { toString(enc: string): string } };

export async function callApi(url: string, body: unknown): Promise<Response> {
  if (typeof body !== 'object') {
    throw new Response('Not Found', { status: 404 });
  }
  const decoded = BufferLike.from('aGVsbG8=', 'base64').toString('utf-8');
  void decoded;
  return fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
}

// Mode: ui-styling-token
// Tailwind utility classes inside cn()/clsx() and a className expression
// are design-system tokens, not arbitrary magic strings.
declare const cn: (...classes: Array<string | false | null | undefined>) => string;
declare const clsx: (...classes: Array<string | false | null | undefined>) => string;

export function buildBannerClasses(active: boolean, status: 'EXPIRED' | 'UNAUTHORIZED' | 'OK'): string {
  return cn(
    'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
    active && 'bg-accent',
    status === 'EXPIRED' && 'border-red-500 text-red-700',
    status === 'UNAUTHORIZED' && 'border-amber-500 text-amber-700',
    clsx('rounded-md', 'px-3', 'py-1.5'),
  );
}

// Mode: constant-definition-self-flagged
// The rule should not fire on the constant declaration itself: exported
// const, `as const` object literals, and enum members are the definition
// site, not an unextracted usage.
export const FIELD_DEFAULT_GENERIC_ALIGN = 'left';

export const TEMPLATE_VIEW_OPTIONS = ['team', 'organisation'] as const;

export const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const;

export enum DocumentStatus {
  Draft = 'DRAFT',
  Pending = 'PENDING',
  Completed = 'COMPLETED',
}



// TS 4.5+ inline `type` modifier within a combined import is valid, idiomatic
// TypeScript. Bundlers strip type-only specifiers correctly; mixing value and
// inline-type specifiers in one statement is the recommended approach when
// `verbatimModuleSyntax` is enabled. These should not be flagged as mixed-type
// import violations.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { readFileSync, type PathLike, type EncodingOption } from 'node:fs';
import { resolve, type FormatInputPathObject, type ParsedPath } from 'node:path';

export function createCounter(initial: number): {
  value: number;
  setter: Dispatch<SetStateAction<number>>;
} {
  const [value, setter] = useState<number>(initial);
  return { value, setter };
}

export function loadConfigFile(
  path: PathLike,
  options: EncodingOption = 'utf-8',
): string {
  return readFileSync(path, options).toString();
}

export function describePath(input: FormatInputPathObject | string): ParsedPath {
  const absolute = typeof input === 'string' ? resolve(input) : resolve(input.dir ?? '.');
  return {
    root: '',
    dir: absolute,
    base: '',
    ext: '',
    name: '',
  };
}



/**
 * Stripe-style webhook handler — `event` is a local `const` in the outer
 * function, then referenced inside nested `match().with(...)` arrow
 * callbacks. The identifier `event` here is not the deprecated implicit
 * global; it is a properly-declared local variable in an enclosing scope.
 */
declare const stripeWebhooksRaiOuterConst: {
  readonly constructEvent: (payload: string, signature: string, secret: string) => {
    readonly type: string;
    readonly data: {
      readonly object: unknown;
      readonly previous_attributes: unknown;
    };
  };
};

declare function matchEventRaiOuterConst<T>(value: string): {
  with: (key: string, handler: () => Promise<T>) => Promise<T>;
};

declare function onSubscriptionCreatedRaiOuterConst(arg: { readonly subscription: { readonly id: string } }): Promise<void>;
declare function onSubscriptionDeletedRaiOuterConst(arg: { readonly subscription: { readonly id: string } }): Promise<void>;

export async function handleStripeWebhookRaiOuterConst(
  payload: string,
  signature: string,
  webhookSecret: string,
): Promise<{ readonly success: boolean }> {
  const event = stripeWebhooksRaiOuterConst.constructEvent(payload, signature, webhookSecret);

  return await matchEventRaiOuterConst<{ readonly success: boolean }>(event.type)
    .with('customer.subscription.created', async () => {
      const subscription = event.data.object as { readonly id: string };
      await onSubscriptionCreatedRaiOuterConst({ subscription });
      return { success: true };
    })
    .with('customer.subscription.deleted', async () => {
      const subscription = event.data.object as { readonly id: string };
      await onSubscriptionDeletedRaiOuterConst({ subscription });
      return { success: true };
    });
}

/**
 * Message-port playground — `event` is the parameter of the outer
 * `handleMessage` arrow, then accessed inside the nested `setMessages`
 * updater callback. The identifier resolves to the outer parameter, not
 * the deprecated implicit global.
 */
declare function setMessagesRaiNestedCallback(updater: (prev: readonly string[]) => readonly string[]): void;

interface RaiMessageTarget {
  readonly addEventListener: (
    name: string,
    handler: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    name: string,
    handler: (event: { readonly data: unknown }) => void,
  ) => void;
}

export function attachPlaygroundMessageHandlerRaiNestedCallback(target: RaiMessageTarget): () => void {
  const handleMessage = (event: { readonly data: unknown }): void => {
    const timestamp = new Date().toISOString().slice(11, 19);
    setMessagesRaiNestedCallback((prev) => [
      ...prev,
      `[${timestamp}] ${JSON.stringify(event.data, null, 2)}`,
    ]);
  };

  target.addEventListener('message', handleMessage);
  return () => target.removeEventListener('message', handleMessage);
}

/**
 * Single-case Stripe handler — separate top-level helper where `event` is
 * declared as a local `const` and read inside a single nested
 * `match().with(...)` arrow callback. Distinct top-level shape from the
 * multi-case handler above.
 */
declare const stripeWebhooksRaiSingleCase: {
  readonly constructEvent: (payload: string, signature: string, secret: string) => {
    readonly type: string;
    readonly data: { readonly object: unknown };
  };
};

declare function matchEventRaiSingleCase<T>(value: string): {
  with: (key: string, handler: () => Promise<T>) => Promise<T>;
};

declare function onSubscriptionUpdatedRaiSingleCase(arg: {
  readonly subscription: { readonly id: string; readonly status: string };
}): Promise<void>;

export async function handleStripeSubscriptionUpdatedRaiSingleCase(
  payload: string,
  signature: string,
  webhookSecret: string,
): Promise<{ readonly success: boolean }> {
  const event = stripeWebhooksRaiSingleCase.constructEvent(payload, signature, webhookSecret);

  return await matchEventRaiSingleCase<{ readonly success: boolean }>(event.type).with(
    'customer.subscription.updated',
    async () => {
      const subscription = event.data.object as { readonly id: string; readonly status: string };
      await onSubscriptionUpdatedRaiSingleCase({ subscription });
      return { success: true };
    },
  );
}



/**
 * Sync FS in async non-request contexts that must NOT trigger
 * performance/deterministic/sync-fs-in-request-handler.
 *
 * MODE: cli-seed-script
 * `seedDatabase` is a one-shot CLI seed script invoked once at the end of the
 * module via `seedDatabase().then(() => process.exit(0))`. There is no HTTP
 * event loop to block, no request handler, no per-request execution path.
 * The enclosing function name matches /seed/i and the call site is not inside
 * any express/fastify/koa/hapi/Next route callback. Sync FS is idiomatic for
 * Prisma seed scripts that read fixture assets once at startup.
 *
 * MODE: startup-lazy-singleton-init
 * `loadCertificates`, `createGoogleCloudSigner`, and the module-level
 * lazy-singleton `getSigner` cache the constructed signer in a module-level
 * variable on first use and short-circuit on every subsequent call. The sync
 * FS reads/writes (cert chain loading, credential bootstrap from an env var
 * for serverless environments) execute at most once during the application
 * lifetime, not once per request. No ancestor node is an HTTP route
 * handler callback; this is module-level initialization, not per-request I/O.
 */

interface BufferLike {
  toString: (encoding?: string) => string;
}
declare const fs: {
  readFileSync: ((p: string) => BufferLike) & ((p: string, encoding: string) => string);
  writeFileSync: (p: string, contents: string) => void;
  readdirSync: (p: string) => readonly string[];
  statSync: (p: string) => { isFile: () => boolean };
  existsSync: (p: string) => boolean;
};
declare const path: { join: (...segments: readonly string[]) => string };
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined>; exit: (code: number) => never };
declare const console: { log: (...args: readonly unknown[]) => void; error: (...args: readonly unknown[]) => void };
declare const Buffer: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } };

interface SeedFile {
  readonly name: string;
  readonly contents: string;
}

interface PrismaSeedClient {
  user: { createMany: (args: { readonly data: readonly { readonly email: string }[] }) => Promise<void> };
  asset: { createMany: (args: { readonly data: readonly { readonly name: string; readonly body: string }[] }) => Promise<void> };
}

declare const prismaSeed: PrismaSeedClient;

export async function seedDatabase(): Promise<void> {
  const files = fs.readdirSync(path.join(__dirname, './seed'));
  const collected: SeedFile[] = [];
  for (const file of files) {
    const stat = fs.statSync(path.join(__dirname, './seed', file));
    if (!stat.isFile()) continue;
    const contents = fs.readFileSync(path.join(__dirname, './seed', file), 'utf-8');
    collected.push({ name: file, contents });
  }

  const examplePdf = fs.readFileSync(path.join(__dirname, '../../../assets/example.pdf')).toString('base64');
  const alignmentPdf = fs
    .readFileSync(path.join(__dirname, '../../../assets/field-font-alignment.pdf'))
    .toString('base64');
  const fieldMetaPdf = fs.readFileSync(path.join(__dirname, '../../../assets/field-meta.pdf')).toString('base64');
  const overflowPdf = fs.readFileSync(path.join(__dirname, '../../../assets/field-overflow.pdf')).toString('base64');

  await prismaSeed.user.createMany({ data: collected.map((f) => ({ email: `${f.name}@example.test` })) });
  await prismaSeed.asset.createMany({
    data: [
      { name: 'example', body: examplePdf },
      { name: 'alignment', body: alignmentPdf },
      { name: 'field-meta', body: fieldMetaPdf },
      { name: 'overflow', body: overflowPdf },
    ],
  });
}

seedDatabase()
  .then(() => {
    console.log('Database seeded');
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

interface PemBlock {
  readonly der: Uint8Array;
}

interface GoogleCloudSigner {
  readonly sign: (payload: string) => Promise<string>;
  readonly chain: readonly Uint8Array[];
  readonly cert: readonly Uint8Array[];
}

declare const parsePem: (input: string) => readonly PemBlock[];
declare const buildGoogleCloudSignerCore: (opts: {
  readonly chain: readonly Uint8Array[];
  readonly cert: readonly Uint8Array[];
}) => GoogleCloudSigner;

async function loadCertificates(opts: {
  readonly chainFilePath?: string;
  readonly certFilePath?: string;
  readonly secretName?: string;
}): Promise<{ readonly chain: readonly Uint8Array[]; readonly cert: readonly Uint8Array[] }> {
  const { chainFilePath, certFilePath, secretName } = opts;
  if (chainFilePath && certFilePath) {
    const chain = parsePem(fs.readFileSync(chainFilePath, 'utf-8')).map((block) => block.der);
    const cert = parsePem(fs.readFileSync(certFilePath, 'utf-8')).map((block) => block.der);
    return { chain, cert };
  }
  if (secretName) {
    await Promise.resolve();
    return { chain: [], cert: [] };
  }
  throw new Error('No certificate source configured');
}

async function createGoogleCloudSigner(): Promise<GoogleCloudSigner> {
  const googleAuthCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '/tmp/gcp-credentials.json';
  if (!fs.existsSync(googleAuthCredentials)) {
    const inline = process.env.GOOGLE_APPLICATION_CREDENTIALS_INLINE;
    if (inline) {
      const contents = Buffer.from(inline, 'base64').toString('utf-8');
      fs.writeFileSync(googleAuthCredentials, contents);
    }
  }
  const { chain, cert } = await loadCertificates({
    chainFilePath: process.env.GOOGLE_SIGNING_CHAIN_PATH,
    certFilePath: process.env.GOOGLE_SIGNING_CERT_PATH,
    secretName: process.env.GOOGLE_SIGNING_SECRET_NAME,
  });
  return buildGoogleCloudSignerCore({ chain, cert });
}

let signerSingleton: GoogleCloudSigner | null = null;
let signerInflight: Promise<GoogleCloudSigner> | null = null;

export async function getSigner(): Promise<GoogleCloudSigner> {
  if (signerSingleton) return signerSingleton;
  if (signerInflight) return signerInflight;
  signerInflight = createGoogleCloudSigner().then((built) => {
    signerSingleton = built;
    signerInflight = null;
    return built;
  });
  return signerInflight;
}



// Remix/Vite browser entry idiom: an async main() is invoked at module top level
// as the standard hydration bootstrap. Top-level await is not available in this
// module context, so the floating call is the only viable pattern. The project
// authors explicitly suppress the linter on the preceding line, which the rule
// must honor.
declare const startTransition: (cb: () => void) => void;
declare const hydrateClientRoot: (container: Element, children: unknown) => void;
declare const clientRootElement: Element;

async function mainClientEntry(): Promise<void> {
  startTransition(() => {
    hydrateClientRoot(clientRootElement, null);
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
mainClientEntry();


// Hono-style rate-limit middleware: the catch wraps getIpAddress(), an IP
// extraction utility. Failing to parse the IP is non-critical, so falling
// back to 'unknown' is deliberate so rate limiting continues with a safe
// default identifier rather than crashing the request. The happy path
// correctly awaits next(); Hono does not use the Express next(error)
// convention so this catch is not a missed propagation.
declare const getIpAddress: (req: unknown) => string;

interface HonoContext {
  req: { raw: unknown };
  header(name: string, value: string): void;
  json(body: unknown, status?: number): unknown;
}

type HonoNext = () => Promise<void>;

interface RateLimitCheckResult {
  isLimited: boolean;
  limit: number;
  remaining: number;
  reset: Date;
}

interface RateLimiter {
  check(input: { ip: string; identifier?: string }): Promise<RateLimitCheckResult>;
}

const setRateLimitHeaders = (c: HonoContext, result: RateLimitCheckResult): void => {
  c.header('X-RateLimit-Limit', String(result.limit));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(result.reset.getTime() / 1000)));
};

export const createRateLimitMiddleware = (
  limiter: RateLimiter,
  options?: { identifierFn?: (c: HonoContext) => string | undefined },
): ((c: HonoContext, next: HonoNext) => Promise<unknown>) => {
  return async (c, next) => {
    let ip: string;

    try {
      ip = getIpAddress(c.req.raw);
    } catch {
      ip = 'unknown';
    }

    const identifier = options?.identifierFn?.(c);

    const result = await limiter.check({ ip, identifier });

    setRateLimitHeaders(c, result);

    if (result.isLimited) {
      c.header(
        'Retry-After',
        String(Math.max(1, Math.ceil((result.reset.getTime() - Date.now()) / 1000))),
      );

      return c.json({ error: 'Too many requests, please try again later.' }, 429);
    }

    await next();
    return undefined;
  };
};
