
/**
 * Third-party framework/library boundary `any` propagation.
 *
 * Documenso pattern: shadcn/ui wrappers around Radix UI primitives copy
 * `displayName` from the primitive (`AccordionPrimitive.Trigger.displayName`).
 * Radix UI's `forwardRef` wrapper types resolve as `any` through the re-export
 * chain, so the property access is flagged even though the code is idiomatic.
 * Same pattern shows up for `form.control` from react-hook-form's `useForm()`
 * — `Control`'s complex generics collapse to `any` at the consumer boundary.
 */
declare const AccordionPrimitive: any;
declare const useForm: () => any;

export function buildAccordionDisplayName(): string {
  const triggerName: string = AccordionPrimitive.Trigger.displayName;
  const headerName: string = AccordionPrimitive.Header.displayName;
  return `${triggerName}/${headerName}`;
}

export function bindFormFieldControl(): unknown {
  const form = useForm();
  const controller = form.control;
  return controller;
}

/**
 * Prisma ORM boundary `any` propagation.
 *
 * Documenso pattern: `prisma.<model>.findUnique/findMany/...` and enum member
 * access (`AppErrorCode.NOT_SETUP`) resolve to `any` at the generated-client
 * type boundary in this analyzer's typeQuery. The code below mirrors that
 * shape — a typical service helper that loads a row and reads a relation.
 */
declare const prisma: any;
declare const AppErrorCode: any;

export async function loadDocumentForToken(token: string): Promise<unknown> {
  const document = await prisma.document.findFirst({
    where: { recipients: { some: { token } } },
    include: { team: { include: { teamEmail: true } } },
  });
  const teamEmail = document.team?.teamEmail?.email;
  if (document.status === AppErrorCode.NOT_SETUP) {
    throw new Error('document not set up');
  }
  return teamEmail;
}

/**
 * Zod schema-builder boundary `any` propagation.
 *
 * Documenso pattern: `z.object({...}).parse(input)` and chained Zod methods
 * resolve through Zod's deeply-nested generic chain into `any` at the
 * consumer call-site. The schema is typed correctly inside Zod but the
 * inferred call return collapses, and `.parse`/`.safeParse` get flagged.
 */
declare const z: any;
declare const zodResolver: any;

export function parseCreateDocumentInput(raw: unknown): { readonly title: string } {
  const Schema = z.object({
    title: z.string().min(1),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  });
  const parsed = Schema.parse(raw);
  return { title: parsed.title };
}

export function buildFormResolver(): unknown {
  const Schema = z.object({ name: z.string() });
  return zodResolver(Schema);
}

/**
 * Lingui i18n macro boundary `any` propagation.
 *
 * Documenso pattern: `_(msg\`...\`)` from `@lingui/react`'s `useLingui()` hook
 * (and the `t\`...\`` macro from `@lingui/macro`) return `any` at the macro
 * boundary. The translation call is idiomatic — the `any` only exists
 * because the macro transform leaves a typing gap.
 */
declare const useLingui: () => { readonly _: (descriptor: unknown) => string };
declare const msg: (strings: TemplateStringsArray) => unknown;
declare const t: any;

export function describeDeleteAction(): string {
  const { _ } = useLingui();
  const label = _(msg`Delete document`);
  const confirmLabel = t`Are you sure?`;
  return `${label} / ${confirmLabel}`;
}

/**
 * Duplicate / multi-location violation propagation.
 *
 * Documenso pattern: a single Prisma-transaction expression
 * (`tx.file.create({...})`) triggers both "calling an `any` typed value"
 * (the outer `create` call) AND "unsafe member access on `any`"
 * (the `tx.file` member access) at the same source position, producing
 * duplicate diagnostics. Same shape for `file.arrayBuffer()` on a File
 * value typed as `any` at the tRPC FormData boundary.
 */
declare const runInTransaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
declare const incomingFile: any;

export async function persistUploadedFile(name: string): Promise<unknown> {
  return runInTransaction(async (tx) => {
    const created = await tx.file.create({ data: { name } });
    const buffer = await incomingFile.arrayBuffer();
    return { created, byteLength: buffer.byteLength };
  });
}



// --- positive fixture for reliability/deterministic/express-async-no-wrapper ---
// Hono routers expose `app.use/get/post/...` and route handlers receive a single
// Hono `Context` parameter (commonly named `c`). Hono propagates promise
// rejections natively to its onError handler, so Express-style async wrappers
// (asyncHandler / try-catch) are unnecessary. The rule must not flag these.

interface HonoEnv {
  Variables: { requestId: string };
}
interface HonoContext {
  req: { param: (name: string) => string; header: (name: string) => string | undefined };
  json: (body: unknown, status?: number) => Response;
  body: (body: BodyInit, init?: ResponseInit) => Response;
  get: <K extends keyof HonoEnv['Variables']>(key: K) => HonoEnv['Variables'][K];
  set: <K extends keyof HonoEnv['Variables']>(key: K, value: HonoEnv['Variables'][K]) => void;
}
type HonoNext = () => Promise<void>;
type HonoHandler = (c: HonoContext) => Promise<Response> | Response;
type HonoMiddleware = (c: HonoContext, next: HonoNext) => Promise<void> | void;
type HonoValidator = (target: 'param' | 'query' | 'json', schema: unknown) => HonoMiddleware;

interface HonoApp {
  use: ((path: string, handler: HonoHandler | HonoMiddleware) => HonoApp) &
    ((handler: HonoMiddleware) => HonoApp);
  get: (path: string, ...handlers: Array<HonoHandler | HonoMiddleware>) => HonoApp;
  post: (path: string, ...handlers: Array<HonoHandler | HonoMiddleware>) => HonoApp;
}

declare const app: HonoApp;
declare const route: HonoApp;
declare const sValidator: HonoValidator;
declare const openApiTrpcServerHandler: (
  c: HonoContext,
  opts: { isBeta: boolean },
) => Promise<Response>;
declare const ZGetEnvelopeItemByTokenParamsSchema: unknown;
declare const ZGetEnvelopeItemPdfRequestParamsSchema: unknown;
declare const getEnvelopeItemPdfByToken: (params: {
  token: string;
  envelopeId: string;
  envelopeItemId: string;
  documentDataId: string;
  version: string;
}) => Promise<ArrayBuffer>;
declare const getEnvelopeItemPdf: (params: {
  userId: string;
  envelopeId: string;
  envelopeItemId: string;
  documentDataId: string;
  version: string;
}) => Promise<ArrayBuffer>;

// mode shape-804278355473: `app.use(path, async (c) => ...)` — Hono delegating
// to an upstream handler. Single Hono Context parameter, not Express (req,res,next).
app.use(`/api/v2/*`, async (c) =>
  openApiTrpcServerHandler(c, {
    isBeta: false,
  }),
);

app.use(`/api/v2-beta/*`, async (c) =>
  openApiTrpcServerHandler(c, {
    isBeta: true,
  }),
);

// mode shape-2dfbb9ade1b5: `route.get(path, sValidator(...), async (c) => ...)`
// Hono route with standard-validator middleware, async Context handler.
route.get(
  '/token/:token/envelope/:envelopeId/envelopeItem/:envelopeItemId/dataId/:documentDataId/:version/item.pdf',
  sValidator('param', ZGetEnvelopeItemByTokenParamsSchema),
  async (c) => {
    const token = c.req.param('token');
    const envelopeId = c.req.param('envelopeId');
    const envelopeItemId = c.req.param('envelopeItemId');
    const documentDataId = c.req.param('documentDataId');
    const version = c.req.param('version');
    const pdf = await getEnvelopeItemPdfByToken({
      token,
      envelopeId,
      envelopeItemId,
      documentDataId,
      version,
    });
    return c.body(pdf, { headers: { 'content-type': 'application/pdf' } });
  },
);

// mode shape-3552a2f677d8: `route.get(path, sValidator(...), async (c) => ...)`
// Same Hono shape but a different route / handler body; identical FP cause.
route.get(
  '/envelope/:envelopeId/envelopeItem/:envelopeItemId/dataId/:documentDataId/:version/item.pdf',
  sValidator('param', ZGetEnvelopeItemPdfRequestParamsSchema),
  async (c) => {
    const userId = c.get('requestId');
    const envelopeId = c.req.param('envelopeId');
    const envelopeItemId = c.req.param('envelopeItemId');
    const documentDataId = c.req.param('documentDataId');
    const version = c.req.param('version');
    const pdf = await getEnvelopeItemPdf({
      userId,
      envelopeId,
      envelopeItemId,
      documentDataId,
      version,
    });
    return c.body(pdf, { headers: { 'content-type': 'application/pdf' } });
  },
);


// Playwright's APIRequestContext exposes a `.fetch()` method on the test
// `request` fixture. Timeouts are governed by the Playwright test runner, not
// by AbortSignal, so passing { method: 'get' } without a signal is idiomatic.
declare const request: {
  fetch(url: string, options: { method: string }): Promise<{ ok: boolean }>;
};
declare const WEBAPP_URL: string;

export async function getCsrfToken(): Promise<{ ok: boolean }> {
  const response = await request.fetch(`${WEBAPP_URL}/api/auth/csrf`, {
    method: 'get',
  });
  return response;
}

// Hono's app.fetch(request) is in-process request dispatch — no network socket
// is opened, so AbortSignal.timeout() is not applicable. The `.fetch` member
// here is the Hono application's own dispatch entry point.
declare const boardApp: { fetch(req: Request): Response };

export function dispatchBoardRequest(c: { req: { raw: Request } }): Response {
  return boardApp.fetch(c.req.raw);
}
