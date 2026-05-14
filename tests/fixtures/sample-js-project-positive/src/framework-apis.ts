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



// --- dead-method shape: framework-invoked-object-literal-callback (job definition) ---
declare function createJob<T>(def: { id: string; handler: (payload: T) => Promise<void> }): void;

const sendWelcomeEmailJob = {
  id: 'send-welcome-email',
  handler: async (payload: { userId: string; email: string }) => {
    await sendTransactionalEmail({ to: payload.email, template: 'welcome', data: { userId: payload.userId } });
  },
};

declare function sendTransactionalEmail(opts: { to: string; template: string; data: Record<string, string> }): Promise<void>;



// --- dead-method shape: abstract-base-class-template-method ---
abstract class BaseQueueClient {
  abstract getApiHandler(): (req: unknown) => Promise<unknown>;

  async startProcessing(): Promise<void> {
    const handler = this.getApiHandler();
    await handler({});
  }
}

class BullMqQueueClient extends BaseQueueClient {
  getApiHandler() {
    return async (req: unknown) => ({ status: 'ok', req });
  }
}



// --- dead-method shape: interop-adapter getter/setter ---
declare function openApiHttpHandler(adapter: { statusCode: number; setHeader: (k: string, v: string) => void }, req: unknown): Promise<Response>;

async function handleOpenApiRequest(req: Request): Promise<Response> {
  let _statusCode = 200;
  const adapter = {
    get statusCode() { return _statusCode; },
    set statusCode(code: number) { _statusCode = code; },
    setHeader(_k: string, _v: string) {},
  };
  return openApiHttpHandler(adapter, req);
}



// --- dead-method shape: interop-adapter getter (mock ServerResponse) ---
declare function createFetchApiHandler(adapter: { statusCode: number; getHeader: (k: string) => string | undefined }): (req: Request) => Promise<Response>;

function buildNodeFetchBridge() {
  const headers: Record<string, string> = {};
  let _code = 200;
  const adapter = {
    get statusCode() { return _code; },
    getHeader(k: string) { return headers[k]; },
  };
  return createFetchApiHandler(adapter);
}



// --- dead-method shape: interface-contract-implementation (DataTransformer deserialize) ---
interface DataTransformer {
  serialize(data: unknown): unknown;
  deserialize(data: unknown): unknown;
}

const superjsonTransformer: DataTransformer = {
  serialize(data: unknown) {
    return JSON.parse(JSON.stringify(data));
  },
  deserialize(data: unknown) {
    return data;
  },
};




// --- argument-type-mismatch shape: i18n date formatting with format token (stdlib/third-party API) ---
declare const i18n_004b: { date: (value: Date, format: object) => string };
declare const DateFormats: { DATE_MED: object; DATE_SHORT: object };
declare const licenseInfo: { periodEnd: Date; periodStart: Date };

function formatLicensePeriod_004b(): string {
  const end = i18n_004b.date(licenseInfo.periodEnd, DateFormats.DATE_MED);
  const start = i18n_004b.date(licenseInfo.periodStart, DateFormats.DATE_SHORT);
  return `${start} – ${end}`;
}




// --- argument-type-mismatch shape: void call to typed procedure with object argument ---
declare function executeWorkflowAction(opts: { workflowId: string; userId: string; action: string }): Promise<void>;

function triggerApprovalAction_010d(workflowId: string, userId: string): void {
  void executeWorkflowAction({ workflowId, userId, action: 'APPROVE' });
}

function triggerRejectionAction_010d(workflowId: string, userId: string): void {
  void executeWorkflowAction({ workflowId, userId, action: 'REJECT' });
}



// FP shape 03e2e3dc40ed: QueryClient.invalidateQueries with predicate — no type mismatch
interface CacheQuery { meta?: Record<string, unknown> }
declare const queryClient: {
  invalidateQueries: (opts: { predicate: (query: CacheQuery) => boolean }) => Promise<void>;
};

async function invalidateNonPersistentQueries() {
  await queryClient.invalidateQueries({
    predicate: (query) => !query?.meta?.skipAutoInvalidation,
  });
}



// FP shape 05195eb1f512: generic factory with destructured callback — no type mismatch
interface ModalProps { title: string; message: string; }
declare function createCallable<TProps, TResult>(
  component: (opts: { call: (result: TResult) => void } & TProps) => JSX.Element
): (props: TProps) => Promise<TResult>;

const showConfirmModal = createCallable<ModalProps, boolean | null>(
  ({ call, title, message }) => (
    <div>
      <h2>{title}</h2>
      <p>{message}</p>
      <button onClick={() => call(true)}>Confirm</button>
      <button onClick={() => call(null)}>Cancel</button>
    </div>
  )
);



// FP shape 05ecf862231c: useEffect with first-render guard — no type mismatch
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useRef<T>(initial: T): { current: T };
declare const onFormValuesChange: () => void;

function useFormChangeEffect() {
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onFormValuesChange();
  });
}



// --- FP shape 19f6cfb40f2c: tRPC useInfiniteQuery hook call ---
interface AuditLogQueryInput {
  resourceId: number;
  cursor?: string;
  limit?: number;
}

interface AuditLogEntry {
  id: string;
  action: string;
  createdAt: Date;
}

interface InfiniteQueryResult<T> {
  data: { pages: Array<{ items: T[]; nextCursor?: string }> } | undefined;
  fetchNextPage: () => void;
  hasNextPage: boolean;
}

declare const trpc: {
  audit: {
    log: {
      find: {
        useInfiniteQuery: (
          input: AuditLogQueryInput,
          opts: { getNextPageParam: (last: { nextCursor?: string }) => string | undefined },
        ) => InfiniteQueryResult<AuditLogEntry>;
      };
    };
  };
};

function useResourceAuditLog(resourceId: number): InfiniteQueryResult<AuditLogEntry> {
  return trpc.audit.log.find.useInfiniteQuery(
    { resourceId, limit: 25 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
}



// FP shape 2b8ae7990e98: library function called with correct named parameters object
declare function generateAuthOptions(params: { appName: string; appId: string; userId: string; timeout?: number }): Promise<unknown>;
declare const appName: string;
declare const appId: string;
declare const userId: string;

export async function buildAuthOptions() {
  return generateAuthOptions({ appName, appId, userId, timeout: 60000 });
}



// FP shape 2bfebdca2991: canvas layer .find().forEach() — Konva-style find returning typed array
declare const canvasLayer: { current: { find: (selector: string) => Array<{ destroy: () => void; id: () => string }> } };

export function clearLayerGroups() {
  canvasLayer.current.find('Group').forEach((group) => {
    group.destroy();
  });
}



// FP shape 2c25c7f1e9e9: middleware callback destructuring multiple named params — standard pattern
declare function authenticatedMiddleware(handler: (args: { requestId: string }, user: { id: string }, team: { id: string }, ctx: unknown) => Promise<unknown>): unknown;

export const listResourcesRoute = authenticatedMiddleware(async (args, user, team, ctx) => {
  void args; void user; void team; void ctx;
  return { resources: [] };
});



// FP shape 2ca6068f6eb9: Promise.all with fetch().then(arrayBuffer) — standard parallel fetch
declare const pdfUrl: string;
declare const metaUrl: string;

export async function fetchDocumentAssets() {
  return Promise.all([
    fetch(pdfUrl).then(async (res) => res.arrayBuffer()),
    fetch(metaUrl).then(async (res) => res.arrayBuffer()),
  ]);
}



// FP shape 2d132d2918f7: Buffer.from(ArrayBuffer) — standard Buffer overload
declare const rawBuffer: ArrayBuffer;

export function convertToBuffer(): Buffer {
  return Buffer.from(rawBuffer);
}



// FP shape 2d35973b8aaa: passing JSON.parse result (any) to typed function — structurally accepted
declare function loadAssetFromStorage(config: { bucket: string; key: string }): Promise<Buffer>;
declare const rawConfig: string;

export async function loadStoredAsset() {
  return loadAssetFromStorage(JSON.parse(rawConfig));
}

declare function resolveRemoteFile(descriptor: { url: string; token: string }): Promise<ArrayBuffer>;
declare const rawDescriptor: string;

export async function resolveStoredFile() {
  return resolveRemoteFile(JSON.parse(rawDescriptor));
}



// FP shape 2d701e893b74: Hono route .post() with validator middleware — standard route setup
declare const router: { post: (path: string, validator: unknown, handler: (ctx: unknown) => Promise<unknown>) => unknown };
declare function sValidator(target: string, schema: unknown): unknown;
declare const ZAuthorizeSchema: unknown;

export function registerAuthorizeRoute() {
  return router.post('/authorize', sValidator('json', ZAuthorizeSchema), async (ctx) => {
    void ctx;
    return { success: true };
  });
}



// FP shape 2d7a571eaa73: Zod schema .shape.data.pick() — standard Zod schema composition
declare const ZConfigSchema: { shape: { data: { pick: (keys: Record<string, true>) => unknown } } };

export const ZPartialConfig = ZConfigSchema.shape.data.pick({
  apiKey: true,
  region: true,
  timeout: true,
});



// FP shape 2da2cd7df075: ts-pattern match().with() — correct API for union type narrowing
declare function match<T>(value: T): { with: <U>(pattern: T, handler: () => U) => { exhaustive: () => U; otherwise: (fn: () => U) => U } };
declare const linkStatus: 'active' | 'disabled' | 'pending';

export function getLinkStatusLabel() {
  return match(linkStatus)
    .with('active', () => 'Active')
    .with('disabled', () => 'Disabled')
    .with('pending', () => 'Pending')
    .exhaustive();
}



// FP shape 2dca270698ee: Promise.all with array of promise-returning function calls
declare function persistFieldChange(fieldId: string, value: unknown): Promise<void>;
declare const fieldUpdates: Array<{ fieldId: string; value: unknown }>;

export async function persistAllFieldChanges() {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  await Promise.all(fieldUpdates.map((u) => persistFieldChange(u.fieldId, u.value)));
}



// FP shape 2dfbb9ade1b5: Hono route.get() with sValidator middleware — standard route definition
declare const apiRouter: { get: (path: string, validator: unknown, handler: (ctx: unknown) => Promise<unknown>) => unknown };
declare function sValidator(target: string, schema: unknown): unknown;
declare const ZFileQuerySchema: unknown;

export function registerFileDownloadRoute() {
  return apiRouter.get('/files/:token', sValidator('param', ZFileQuerySchema), async (ctx) => {
    void ctx;
    return { stream: null };
  });
}



// FP shape 2e23cfb547cd: Zod z.string().refine() with split/filter — standard Zod refinement
declare const z: { string: () => { refine: (fn: (val: string) => boolean, msg: string) => unknown } };

export const ZTagList = z.string().refine(
  (value) => value.split(',').filter(Boolean).every((t) => t.trim().length > 0),
  'Each tag must be non-empty',
);



// FP shape 2ef6bc18aef0: .then()/.catch() callbacks with correct return types
declare function findAccountByEmail(params: { email: string }): Promise<{ id: string } | null>;
declare const recipientEmail: string;

export async function checkAccountExists(): Promise<boolean> {
  return findAccountByEmail({ email: recipientEmail })
    .then((account) => account !== null)
    .catch(() => false);
}



// FP shape 2ef97f804590: middleware callback signature matches expected type — no mismatch
declare function withAuth(handler: (args: { requestId: string }, user: { id: string; email: string }, team: { slug: string } | null, ctx: unknown) => Promise<unknown>): unknown;

export const getProfileRoute = withAuth(async (args, user, team, ctx) => {
  void args; void team; void ctx;
  return { userId: user.id, email: user.email };
});

export const listTeamMembersRoute = withAuth(async (args, user, team, ctx) => {
  void args; void user; void ctx;
  return { teamSlug: team?.slug, members: [] };
});



// FP shape 2f25e164c699: ts-pattern match().with(EnumValue, async handler) — correct enum-based matching
declare function match<T>(value: T): { with: <U>(pattern: T, handler: () => U | Promise<U>) => { exhaustive: () => U | Promise<U>; otherwise: (fn: () => U) => U | Promise<U> } };
declare const ResourceType: { DOCUMENT: 'document'; TEMPLATE: 'template' };
type ResourceTypeValue = typeof ResourceType[keyof typeof ResourceType];
declare const resourceType: ResourceTypeValue;
declare function processDocument(opts: { resourceId: string }): Promise<void>;
declare function processTemplate(opts: { resourceId: string }): Promise<void>;
declare const resourceId: string;

export async function dispatchResourceProcessing() {
  return match(resourceType)
    .with(ResourceType.DOCUMENT, async () => processDocument({ resourceId }))
    .with(ResourceType.TEMPLATE, async () => processTemplate({ resourceId }))
    .exhaustive();
}



// FP shape 2f5a63dbfccd: createUser().catch() — error callback correctly typed
declare function createAccount(params: { name: string; email: string; passwordHash: string }): Promise<{ id: string }>;
declare function logRegistrationError(err: unknown): void;
declare const name: string, email: string, passwordHash: string;

export function registerAccount() {
  return createAccount({ name, email, passwordHash }).catch((err) => {
    logRegistrationError(err);
    throw err;
  });
}



// FP shape 2f5bbe05210f: ts-pattern match(enum).with(EnumValue, ...) — correct enum-based pattern matching
declare function match<T>(value: T): { with: <U>(pattern: T, handler: () => U) => { exhaustive: () => U; otherwise: (fn: () => U) => U } };
declare const CompletionStatus: { SUCCESS: 'success'; PARTIAL: 'partial'; FAILED: 'failed' };
type CompletionStatusValue = typeof CompletionStatus[keyof typeof CompletionStatus];
declare const completionStatus: CompletionStatusValue;

export function getCompletionMessage() {
  return match(completionStatus)
    .with(CompletionStatus.SUCCESS, () => 'All items completed successfully.')
    .with(CompletionStatus.PARTIAL, () => 'Some items could not be completed.')
    .with(CompletionStatus.FAILED, () => 'Processing failed. Please retry.')
    .exhaustive();
}



// FP shape 2f694d638250: dynamic import() — standard lazy import pattern
export async function loadHeavyProcessor() {
  const { HeavyProcessor } = await import('./heavy-processor');
  return new HeavyProcessor();
}



// FP shape: client.create({links: [splitLink({...})]}) — standard RPC client setup
declare const rpcClient: { create: (opts: { links: unknown[] }) => unknown };
declare function splitLink(opts: { condition: (op: unknown) => boolean; true: unknown; false: unknown }): unknown;
declare const httpLink: unknown;
declare const wsLink: unknown;

const client = rpcClient.create({
  links: [
    splitLink({
      condition: (op: any) => op.type === 'subscription',
      true: wsLink,
      false: httpLink,
    }),
  ],
});



// FP shape: procedure.input(Schema).output(Schema) — standard fluent tRPC builder chain
declare const authenticatedProcedure: {
  input: (schema: unknown) => { output: (schema: unknown) => { mutation: (fn: unknown) => unknown } };
};
declare const ZCreateItemRequestSchema: unknown;
declare const ZCreateItemResponseSchema: unknown;

const createItemMutation = authenticatedProcedure
  .input(ZCreateItemRequestSchema)
  .output(ZCreateItemResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return { id: 1, ...input };
  });



// React forwardRef with generic type parameters - valid pattern
declare namespace React {
  interface HTMLAttributes<T> {
    className?: string;
    style?: Record<string, unknown>;
  }
  function forwardRef<T, P = Record<string, unknown>>(
    render: (props: P, ref: React.Ref<T>) => React.ReactElement | null
  ): React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<T>>;
  interface ForwardRefExoticComponent<P> {
    (props: P): React.ReactElement | null;
    displayName?: string;
  }
  interface PropsWithoutRef<P> {}
  interface RefAttributes<T> {}
  type Ref<T> = ((instance: T | null) => void) | { current: T | null } | null;
  interface ReactElement {}
}

const DataGrid = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    columns?: number;
    gap?: string;
  }
>(({ className, columns = 3, gap = '1rem', ...props }, ref) => {
  const style = { display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap };
  return React.createElement('div', { ref, className, style, ...props });
});

DataGrid.displayName = 'DataGrid';

const StatusPanel = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & {
    variant?: 'info' | 'warning' | 'error';
  }
>(({ className, variant = 'info', ...props }, ref) => {
  return React.createElement('section', { ref, className, 'data-variant': variant, ...props });
});

StatusPanel.displayName = 'StatusPanel';



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// Hono-style framework middleware chaining - callback signature matches MiddlewareHandler type
declare class Context {
  set(key: string, value: unknown): void;
  get req(): { raw: Request; header(name: string): string | undefined };
  json(data: unknown, status?: number): Response;
}

type Next = () => Promise<void>;
type MiddlewareHandler<T = unknown> = (c: Context, next: Next) => Promise<Response | void>;

interface AppContext {
  Variables: {
    requestMetadata?: Record<string, unknown>;
  };
}

declare class WebFramework<T = unknown> {
  constructor();
  use(handler: MiddlewareHandler<T>): this;
  get(path: string, handler: MiddlewareHandler<T>): this;
  route(path: string, routes: WebFramework<T>): this;
}

declare function extractMetadata(req: Request): Record<string, unknown>;
declare const APP_ORIGIN: string;

// Standard framework middleware chaining pattern - no type mismatch
export const apiRouter = new WebFramework<AppContext>()
  .use(async (c, next) => {
    c.set('requestMetadata', extractMetadata(c.req.raw));

    const validOrigin = new URL(APP_ORIGIN).origin;
    const headerOrigin = c.req.header('Origin');

    if (headerOrigin && headerOrigin !== validOrigin) {
      return c.json(
        {
          message: 'Forbidden',
          statusCode: 403,
        },
        403,
      );
    }

    await next();
  })
  .get('/health', async (c) => {
    return c.json({ status: 'ok' });
  });



// ORM transaction callback patterns - async callbacks are correct API usage
declare const database: {
  $transaction<T>(callback: (client: any) => Promise<T>): Promise<T>;
  user: { create(data: any): Promise<any>; findMany(args?: any): Promise<any[]>; count(args?: any): Promise<number> };
};

export async function createUserWithProfile(email: string, displayName: string) {
  const result = await database.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: { email, name: displayName },
    });
    return newUser;
  });
  return result;
}

export async function getUserStats() {
  const total = await database.user.count();
  const users = await database.user.findMany({ take: 10 });
  return { total, users };
}

declare const queryBuilder: {
  select(...columns: string[]): any;
  fn(name: string, ...args: any[]): any;
  innerJoin(table: string, condition: any): any;
};

export function buildComplexQuery() {
  return queryBuilder
    .select('users.id', 'users.name')
    .innerJoin('profiles', queryBuilder.fn('eq', 'users.id', 'profiles.user_id'));
}



// Positive: argument-type-mismatch — tRPC fluent builder chains (valid framework pattern)
declare const authenticatedProcedure: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: (handler: (opts: { ctx: unknown; input: unknown }) => Promise<unknown>) => unknown;
      query: (handler: (opts: { ctx: unknown; input: unknown }) => Promise<unknown>) => unknown;
    };
    mutation: (handler: (opts: { ctx: unknown; input: unknown }) => Promise<unknown>) => unknown;
    query: (handler: (opts: { ctx: unknown; input: unknown }) => Promise<unknown>) => unknown;
  };
  mutation: (handler: (opts: { ctx: unknown; input: unknown }) => Promise<unknown>) => unknown;
};

declare const CreateNotificationSchema: unknown;
declare const UpdateUserPreferencesSchema: unknown;
declare const BulkEmailSchema: unknown;

export const notificationRouter = {
  create: authenticatedProcedure
    .input(CreateNotificationSchema)
    .mutation(async ({ ctx, input }) => {
      return { success: true, notificationId: '123' };
    }),

  updatePreferences: authenticatedProcedure.input(UpdateUserPreferencesSchema).mutation(async ({ ctx, input }) => {
    const { userId, preferences } = input as { userId: string; preferences: unknown };
    return { updated: true };
  }),

  sendBulkEmail: authenticatedProcedure.input(BulkEmailSchema).query(async ({ ctx, input }) => {
    const { recipientIds, subject } = input as { recipientIds: string[]; subject: string };
    return { sent: recipientIds.length };
  }),
};



// tRPC mutation with typed callback parameter destructuring
declare const trpc: {
  user: {
    profile: {
      update: {
        useMutation: (opts: {
          onSuccess?: (result: { data: { id: string; name: string }, meta?: { timestamp: number } }) => void;
        }) => { mutateAsync: (input: any) => Promise<void> };
      };
    };
  };
};

export function setupProfileMutation() {
  const { mutateAsync: updateProfile } = trpc.user.profile.update.useMutation({
    onSuccess: ({ data, meta }) => {
      console.log(`Updated profile ${data.id} with name ${data.name}`);
      if (meta) {
        console.log(`Operation completed at ${meta.timestamp}`);
      }
    },
  });
  return updateProfile;
}



// Positive: tRPC fluent builder chains — .input()/.mutation()/.query() are type-safe by design
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => unknown;
  number: () => unknown;
};

declare const trpc: {
  procedure: {
    input: (schema: unknown) => {
      mutation: (handler: (opts: { input: unknown; ctx: unknown }) => unknown) => unknown;
      query: (handler: (opts: { input: unknown; ctx: unknown }) => unknown) => unknown;
    };
    mutation: (handler: (opts: { ctx: unknown }) => unknown) => unknown;
    query: (handler: (opts: { ctx: unknown }) => unknown) => unknown;
    meta: (data: unknown) => unknown;
  };
};

const updatePreferencesSchema = z.object({
  locale: z.string(),
  theme: z.string(),
});

export const updatePreferencesProcedure = trpc.procedure
  .input(updatePreferencesSchema)
  .mutation(async ({ input, ctx }) => {
    return { success: true, locale: input };
  });

const fetchSettingsSchema = z.object({
  userId: z.string(),
});

export const fetchSettingsProcedure = trpc.procedure
  .input(fetchSettingsSchema)
  .query(async ({ input, ctx }) => {
    return { userId: input, settings: {} };
  });

export const healthCheckProcedure = trpc.procedure
  .query(async ({ ctx }) => {
    return { status: 'healthy', timestamp: Date.now() };
  });

export const adminMetaProcedure = trpc.procedure
  .meta({ requiresAuth: true, role: 'admin' });



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// Shape: event emitter .on() with multi-event string and arrow function callback
interface CanvasStage {
  on(eventName: string, callback: (e: { target: unknown; evt: MouseEvent | TouchEvent }) => void): void;
}
declare const stage: CanvasStage;

function registerStageInteractions(stage: CanvasStage, onPointerUp: () => void) {
  stage.on('mouseup touchend', () => {
    onPointerUp();
  });

  stage.on('mousedown', (e) => {
    // handle pointer down
    void e.evt;
  });
}



// Shape: event emitter stage.on('mousedown', callback) — arrow function callback correct type
interface CanvasEventObject { target: { hasName(name: string): boolean }; evt: MouseEvent; }
interface StageEmitter {
  on(eventName: 'mousedown' | 'mouseup' | 'mousemove', callback: (e: CanvasEventObject) => void): void;
  getPointerPosition(): { x: number; y: number } | null;
}
declare const canvasStage: StageEmitter;

function setupStageHandlers(stage: StageEmitter, onDeselect: () => void) {
  stage.on('mousedown', (e) => {
    if (!e.target.hasName('draggable-item')) {
      onDeselect();
    }
  });
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// FP shape 916da3a9ad16: Lingui _() with object lookup result — valid MessageDescriptor, no type mismatch
type MessageDescriptor = { id: string; message?: string };
declare function _(msg: MessageDescriptor): string;
declare const SOURCE_LABELS: Record<string, MessageDescriptor>;

function renderSourceLabel(source: string): string {
  return _(SOURCE_LABELS[source]);
}



// FP shape 9215ea7ff1ff: i18n.date() with spread format options — valid DateTimeFormatOptions, no type mismatch
declare const DATETIME_SHORT: Intl.DateTimeFormatOptions;
declare const i18n: { date: (date: Date, opts: Intl.DateTimeFormatOptions) => string };

function formatCreatedAt(date: Date): string {
  return i18n.date(date, { ...DATETIME_SHORT, hourCycle: 'h12' });
}



// FP shape 924c84ddb7ec: Hono .all() handler passing c.req.raw to handler function — standard Hono pattern, no type mismatch
declare function processWebhookRequest(req: Request): Promise<Response>;
declare function listItemsHandler(req: Request): Promise<Response>;
declare const app: {
  all: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => typeof app;
  get: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => typeof app;
};

app
  .all('/api/webhooks/inbound', async (c) => processWebhookRequest(c.req.raw))
  .all('/api/items', async (c) => listItemsHandler(c.req.raw));



// FP shape 92ef6772d649: tRPC useMutation with onSuccess destructuring result — type matches generated return type, no type mismatch
declare function useMutation<TData, TInput>(opts: {
  mutationFn?: (input: TInput) => Promise<TData>;
  onSuccess?: (data: TData) => void;
}): { mutateAsync: (input: TInput) => Promise<TData> };

type UpdateItemResult = { items: { id: string; name: string }[] };

const { mutateAsync: updateItems } = useMutation<UpdateItemResult, { id: string; name: string }[]>({
  onSuccess: ({ items: updatedItems }) => {
    console.log('Updated', updatedItems.length, 'items');
  },
});



// FP shape 94a975549ad5: Hono .get() handler passing c.req.raw — standard pattern, no type mismatch
declare function verifyCredentialsHandler(req: Request): Promise<Response>;
declare const router: {
  get: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => typeof router;
};

router
  .get('/auth/verify', async (c) => verifyCredentialsHandler(c.req.raw));



// FP shape 957b606e910e: tRPC .input().mutation() route definition — standard tRPC pattern, no type mismatch
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => unknown;
  number: () => unknown;
};
declare function authenticatedProcedure(): {
  input: (schema: unknown) => {
    mutation: (fn: (opts: { input: Record<string, unknown>; ctx: { user: { id: string } } }) => Promise<unknown>) => unknown;
  };
};

const deleteTeamRoute = authenticatedProcedure()
  .input(z.object({ teamId: z.number() }))
  .mutation(async ({ input, ctx }) => {
    const { teamId } = input as { teamId: number };
    return { success: true, teamId, userId: ctx.user.id };
  });



// --- FP shape: i18n translate function called with tagged template result ---
interface MessageDescriptor { id: string }
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): MessageDescriptor;
declare function _(descriptor: MessageDescriptor): string;

const label = _( msg\`Time Zone\` );
const anotherLabel = _( msg\`Date Format\` );



// --- FP shape: canvas event handler with target identity check ---
declare const stage: {
  on(event: string, handler: (e: { target: unknown }) => void): void;
  getPointerPosition(): { x: number; y: number } | null;
};

stage.on('mousedown touchstart', (e) => {
  if (e.target !== stage) {
    return;
  }
  const pos = stage.getPointerPosition();
  if (!pos) return;
  const { x, y } = pos;
  void x; void y;
});



// --- FP shape: translate function called with constant map lookup result ---
type FieldType2 = 'TEXT' | 'SIGNATURE' | 'DATE';
interface MessageDescriptor2 { id: string }
declare function translate(d: MessageDescriptor2): string;
declare function makeMsg(strings: TemplateStringsArray): MessageDescriptor2;
declare const FIELD_LABEL_MAP: Record<FieldType2, MessageDescriptor2>;
declare const selectedField: FieldType2;

const fieldLabel = translate(FIELD_LABEL_MAP[selectedField]);



// --- FP shape: dynamic import inside useEffect with .then() callback ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare const setLibInstance: (lib: { generate(): string }) => void;

useEffect(() => {
  import('./heavy-lib').then((mod) => {
    setLibInstance(mod.default);
  });
}, []);



// --- FP shape: ts-pattern match(...).with(...) chain ---
declare function match<T>(value: T): {
  with<P>(pattern: P, handler: () => unknown): { otherwise(fn: () => unknown): unknown };
};
declare const status: 'active' | 'pending' | 'inactive';
declare const isAdmin: boolean;

const displayLabel = match({ status, isAdmin })
  .with({ status: 'active', isAdmin: true }, () => 'Active Admin')
  .otherwise(() => 'Regular User');



// --- FP shape: dynamic import().then() with typed module callback ---
interface MockGenerator { generate(template: string): string }
declare const setGenerator: (gen: MockGenerator) => void;

void import('./mock-data-generator').then((mod: { generator: MockGenerator }) => {
  setGenerator(mod.generator);
});



// tRPC useMutation with async onSuccess callback — fluent builder chain pattern
declare const trpcClient: {
  users: {
    updateProfile: {
      useMutation: (options: { onSuccess?: (data: any) => Promise<void> | void }) => void;
    };
  };
};

declare const revalidateCache: () => Promise<void>;
declare const onUpdateComplete: (() => Promise<void>) | undefined;
declare const updateLocalState: (profile: any) => void;

export function useProfileUpdate() {
  trpcClient.users.updateProfile.useMutation({
    onSuccess: async (data) => {
      await revalidateCache();
      await onUpdateComplete?.();
      updateLocalState(data.profile);
    },
  });
}


\n/**\n * Test framework configuration builder pattern.\n * defineTestConfig() accepts a configuration object - no type mismatch.\n */\n\ninterface TestConfig {\n  testDir?: string;\n  parallel?: boolean;\n  workers?: number;\n  maxFailures?: number;\n  retries?: number;\n  timeout?: number;\n  reporter?: string[];\n  use?: {\n    baseURL?: string;\n    trace?: string;\n    video?: string;\n  };\n}\n\ndeclare function defineTestConfig(config: TestConfig): TestConfig;\n\nexport const testConfiguration = defineTestConfig({\n  testDir: './tests',\n  parallel: true,\n  workers: 10,\n  maxFailures: process.env.CI ? 1 : undefined,\n  retries: process.env.CI ? 4 : 1,\n  timeout: 30000,\n  reporter: ['html', 'json'],\n  use: {\n    baseURL: 'http://localhost:3000',\n    trace: 'retain-on-failure',\n    video: 'retain-on-failure',\n  },\n});\n



// Zod schema picking pattern - standard library API
declare const z: {
  object: (shape: Record<string, unknown>) => ZodSchema;
  string: () => unknown;
  number: () => unknown;
  boolean: () => unknown;
  array: (item: unknown) => unknown;
};

interface ZodSchema {
  pick<T extends Record<string, true>>(mask: T): ZodSchema;
  extend(shape: Record<string, unknown>): ZodSchema;
}

declare const UserProfileSchema: ZodSchema;

const ProfileUpdateSchema = UserProfileSchema.pick({
  username: true,
  email: true,
  displayName: true,
  bio: true,
  avatar: true,
  preferences: true,
});

declare const ProductMetadataSchema: ZodSchema;

const ProductFormSchema = ProductMetadataSchema.pick({
  title: true,
  description: true,
  price: true,
  category: true,
  tags: true,
  featured: true,
}).extend({
  quantity: z.number(),
});



// Zod schema validation with refine - correct callback signature
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { refine: (fn: (val: string) => boolean, opts: { message: string }) => unknown };
  array: <T>(schema: T) => { refine: (fn: (items: unknown[]) => boolean, opts: { message: string }) => unknown };
};

export const UserTagsSchema = z.object({
  userId: z.string(),
  tags: z.array(z.string()).refine(
    (items) => new Set(items).size === items.length,
    {
      message: 'Tags must be unique',
    }
  ),
});

export const BatchUpdateSchema = z.object({
  userIds: z.array(z.string()).refine(
    (ids) => new Set(ids).size === ids.length,
    {
      message: 'User IDs must be unique',
    }
  ),
});



// Localization API with date formatting - i18n libraries accept Date objects
declare const localization: {
  date(d: Date): string;
  time(d: Date): string;
  datetime(d: Date): string;
};

interface DataRow<T> {
  getValue<K extends keyof T>(key: K): T[K];
}

interface RecordData {
  timestamp: string;
  updatedAt: string;
}

export function formatRecordTimestamp(record: DataRow<RecordData>): string {
  return localization.date(new Date(record.getValue("timestamp")));
}

export function formatRecordUpdated(record: DataRow<RecordData>): string {
  return localization.datetime(new Date(record.getValue("updatedAt")));
}



// tRPC mutation with onSuccess callback — standard pattern
declare const trpc: {
  notification: {
    send: {
      useMutation: (options: {
        onSuccess?: (data: { id: string; sent: boolean }) => void;
        onError?: (error: Error) => void;
      }) => {
        mutateAsync: (input: { userId: string; message: string }) => Promise<{ id: string; sent: boolean }>;
      };
    };
  };
};

export function setupNotificationMutation() {
  const { mutateAsync: sendNotification } = trpc.notification.send.useMutation({
    onSuccess: (data) => {
      console.log('Notification sent:', data.id);
      if (data.sent) {
        console.log('Delivery confirmed');
      }
    },
    onError: (error) => {
      console.error('Failed to send notification:', error.message);
    },
  });

  return sendNotification;
}



// Positive: tRPC-style fluent builder chain (meta → input → output → query)
// The analyzer should recognize this as a valid fluent API pattern, not an argument type mismatch
declare const baseProcedure: {
  meta: (schema: unknown) => {
    input: (schema: unknown) => {
      output: (schema: unknown) => {
        query: (handler: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => void;
      };
    };
  };
};

declare const ListProjectsMetaSchema: unknown;
declare const ListProjectsInputSchema: unknown;
declare const ListProjectsOutputSchema: unknown;

export const listProjectsEndpoint = baseProcedure
  .meta(ListProjectsMetaSchema)
  .input(ListProjectsInputSchema)
  .output(ListProjectsOutputSchema)
  .query(async ({ input, ctx }) => {
    const userId = (ctx as { userId: string }).userId;
    const filters = input as { status?: string; limit?: number };
    return {
      projects: [],
      total: 0,
      userId,
      filters,
    };
  });



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// FP: tRPC query hook with typed inputs — no type mismatch
declare const api: {
  admin: {
    logs: {
      findAuditEntries: {
        useQuery: (input: { resourceId: string; page: number; perPage: number }, opts?: unknown) => unknown;
      };
    };
  };
};
declare const resourceId: string;
declare const page: number;
declare const perPage: number;

const logsQuery = api.admin.logs.findAuditEntries.useQuery(
  { resourceId, page, perPage },
  { placeholderData: (prev: unknown) => prev },
);



// FP: useMemo with API client creation — standard React pattern
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const apiClient: { createClient: (opts: { endpoint: string; headers?: Record<string, string> }) => unknown };
declare const headers: Record<string, string> | undefined;

function useApiClient() {
  const client = useMemo(
    () =>
      apiClient.createClient({
        endpoint: '/api/v1',
        headers,
      }),
    [headers],
  );
  return client;
}



// FP: useMemo returning column defs — tanstack-table column definitions; correctly typed
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function createColumnHelper<T>(): { accessor: (key: keyof T, opts: { header: string }) => unknown };
interface Member { id: string; name: string; email: string; role: string }

const columnHelper = createColumnHelper<Member>();

function useMemberColumns() {
  const columns = useMemo(() => {
    return [
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('email', { header: 'Email' }),
      columnHelper.accessor('role', { header: 'Role' }),
    ];
  }, []);
  return columns;
}



// ts-pattern multi-value .with(): valid API that accepts multiple patterns
// before the handler callback; argument-type-mismatch must not fire here.

declare const enum OrderStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  CANCELLED = 'cancelled',
}

interface PatternMatchBuilder<R> {
  with(...args: unknown[]): PatternMatchBuilder<R>;
  exhaustive(): R;
  otherwise(handler: () => R): R;
}

declare function match<T>(value: T): PatternMatchBuilder<string>;

export function describeOrderStatus(status: OrderStatus): string {
  return match(status)
    .with(OrderStatus.PENDING, OrderStatus.PROCESSING, () => 'In progress')
    .with(OrderStatus.SHIPPED, () => 'On the way')
    .with(OrderStatus.CANCELLED, () => 'Cancelled')
    .exhaustive();
}



// Generic-typed router construction — type param is not a runtime argument
declare interface RequestCtx {
  json: (body: unknown, status?: number) => Response;
}

declare interface RouteEnv {
  Variables: { requestId: string };
}

declare class TypedRouter<E> {
  post(path: string, handler: (c: RequestCtx) => Response | Promise<Response>): TypedRouter<E>;
  get(path: string, handler: (c: RequestCtx) => Response | Promise<Response>): TypedRouter<E>;
}

export const documentsRoute = new TypedRouter<RouteEnv>()
  .post('/upload', (c) => {
    return c.json({ uploaded: true }, 201);
  })
  .get('/list', (c) => {
    return c.json([]);
  });



// ts-pattern exhaustive matching — correct usage, not a type mismatch
declare function match<T>(value: T): any;

type CheckoutStep = 'SELECT_PLAN' | 'CONFIGURE_BILLING' | 'CONFIRM_ORDER';

declare const selectedPlanId: string | null;
declare const currentStep: CheckoutStep;
declare const BillingForm: any;
declare const PlanList: any;
declare const OrderSummary: any;

export function renderCheckoutStep(): any {
  return match({ planId: selectedPlanId, currentStep })
    .with({ currentStep: 'SELECT_PLAN' }, () => PlanList)
    .with({ currentStep: 'CONFIGURE_BILLING' }, () => BillingForm)
    .with({ currentStep: 'CONFIRM_ORDER' }, () => OrderSummary)
    .exhaustive();
}



// No-arg framework router constructor followed by method chaining.
// new Router() takes no arguments — no type mismatch is possible.

interface RouterCtx {
  req: { param: (key: string) => string };
  json: (body: unknown) => unknown;
}

declare class Router {
  get(path: string, handler: (c: RouterCtx) => unknown): this;
  post(path: string, handler: (c: RouterCtx) => unknown): this;
  delete(path: string, handler: (c: RouterCtx) => unknown): this;
}

declare function listItems(ctx: RouterCtx): Promise<unknown[]>;
declare function removeItem(ctx: RouterCtx, id: string): Promise<void>;

export const itemRoute = new Router()
  .get('/items', async (c) => {
    const items = await listItems(c);
    return c.json({ items });
  })
  .delete('/items/:itemId', async (c) => {
    const itemId = c.req.param('itemId');
    await removeItem(c, itemId);
    return c.json({ success: true });
  });



// useEffect with conditional early-return guard -- valid React pattern, no type mismatch
declare function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
declare function useState<T>(initial: T): [T, (val: T) => void];

interface ChartData {
  labels: string[];
  values: number[];
}

export function useChartRenderer(data: ChartData | null, containerId: string): void {
  const [, setRendered] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }

    let active = true;

    const render = () => {
      const container = document.getElementById(containerId);
      if (!container || !active) {
        return;
      }
      container.dataset["labels"] = data.labels.join(",");
      container.dataset["values"] = data.values.join(",");
      setRendered(true);
    };

    render();

    return () => {
      active = false;
    };
  }, [data, containerId]);
}



// tRPC optimistic cache update: utils.<ns>.<proc>.setData(input, updater) is the
// correct tRPC v10 cache-mutation API -- both arguments are typed by the procedure.
declare const postUtils: {
  posts: {
    getById: {
      setData: (
        input: { postId: string },
        updater: (old: PostRecord | undefined) => PostRecord | undefined,
      ) => void;
    };
  };
};

interface PostRecord {
  id: string;
  title: string;
  publishedAt: string | null;
}

export function applyOptimisticTitleUpdate(
  postId: string,
  newTitle: string,
): void {
  postUtils.posts.getById.setData(
    { postId },
    (old) => (old ? { ...old, title: newTitle } : undefined),
  );
}



// tRPC-style fluent procedure builder chain -- correctly typed, must not trigger argument-type-mismatch
declare const protectedProcedure: {
  input<T>(schema: T): {
    mutation<R>(handler: (opts: { input: any; ctx: RequestContext }) => Promise<R>): void;
    query<R>(handler: (opts: { input: any; ctx: RequestContext }) => Promise<R>): void;
  };
};

interface RequestContext {
  userId: string;
  teamId: string;
  logger: { info(data: unknown): void };
}

declare const ZUpdateProjectSchema: { parse(x: unknown): { id: string; name: string; description: string } };
declare function updateProjectById(opts: {
  id: string;
  data: { name: string; description: string };
  userId: string;
  teamId: string;
}): Promise<{ id: string }>;

export const updateProject = protectedProcedure.input(ZUpdateProjectSchema).mutation(async ({ input, ctx }) => {
  const { id, ...data } = input;

  ctx.logger.info({ input: { id } });

  return await updateProjectById({
    id,
    data,
    userId: ctx.userId,
    teamId: ctx.teamId,
  });
});



// tRPC fluent builder chain — schema validation via .input/.output/.meta chaining
declare const authenticatedProcedure: {
  meta(m: unknown): typeof authenticatedProcedure;
  input<S>(schema: S): typeof authenticatedProcedure;
  output<S>(schema: S): typeof authenticatedProcedure;
  query<T>(handler: T): unknown;
  mutation<T>(handler: T): unknown;
};

declare const ZCreateOrderRequestSchema: unknown;
declare const ZCreateOrderResponseSchema: unknown;
declare const createOrderMeta: { openapi: { method: string; path: string } };

export const createOrderRoute = authenticatedProcedure
  .meta(createOrderMeta)
  .input(ZCreateOrderRequestSchema)
  .output(ZCreateOrderResponseSchema)
  .mutation(async ({ input, ctx }: { input: { items: string[]; total: number }; ctx: { userId: string } }) => {
    const { userId } = ctx;
    const { items, total } = input as { items: string[]; total: number };
    return { orderId: 'order-' + userId, items, total };
  });

declare const ZGetOrderRequestSchema: unknown;
declare const ZGetOrderResponseSchema: unknown;

export const getOrderRoute = authenticatedProcedure
  .input(ZGetOrderRequestSchema)
  .output(ZGetOrderResponseSchema)
  .query(async ({ input, ctx }: { input: { orderId: string }; ctx: { userId: string } }) => {
    const { orderId } = input as { orderId: string };
    return { orderId, status: 'pending' };
  });



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// cba23829c1c7: createTRPCReact generic call with overrides config object
declare function createTRPCReact<TRouter>(opts: {
  overrides?: {
    useMutation?: {
      onSuccess?: (opts: { originalFn: () => Promise<void> }) => Promise<void>;
    };
  };
}): unknown;
interface ApiRouter {}

const trpcReact = createTRPCReact<ApiRouter>({
  overrides: {
    useMutation: {
      async onSuccess(opts) {
        await opts.originalFn();
      },
    },
  },
});



// ccb0cc49d46b: t.middleware() tRPC middleware with async destructured callback
declare const t: {
  middleware<T>(fn: (opts: { ctx: { session: unknown | null; user: unknown | null }; next: () => Promise<T>; path: string }) => Promise<T>): unknown;
};
class TRPCError extends Error { constructor(opts: { code: string; message: string }) { super(opts.message); } }

const authMiddleware = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.session || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `Unauthorized access at ${path}` });
  }
  return next();
});



// cd77048d1735: authenticatedProcedure.meta({...}) tRPC fluent chain — false positive because the range
// of the outer .meta() call spans the entire procedure definition including the .query() callback.
declare const authenticatedProcedure: {
  meta(meta: { openapi: { method: string; path: string; summary: string; tags: string[] } }): {
    input<T>(schema: T): {
      output<U>(schema: U): {
        query(resolver: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>): unknown;
        mutation(resolver: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>): unknown;
      };
    };
  };
};
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { optional(): unknown };
};

const listProjectsRoute = authenticatedProcedure
  .meta({
    openapi: {
      method: 'GET',
      path: '/projects',
      summary: 'List all projects',
      tags: ['Projects'],
    },
  })
  .input(z.object({ page: z.string().optional() }))
  .output(z.object({ projects: z.object({}) }))
  .query(async ({ input, ctx }) => {
    return { projects: {} };
  });



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// --- argument-type-mismatch shape: i18n.date() call with Date argument for locale-aware formatting ---
declare const i18n: { date: (d: Date, opts?: object) => string };

function formatSubscriptionRenewal(renewalDate: Date | null, planName: string | null): string {
  if (!renewalDate) {
    return planName ? `Subscribed to ${planName}` : 'Active plan';
  }
  const formatted = i18n.date(renewalDate);
  return planName
    ? `${planName} renews on ${formatted}`
    : `Your plan renews on ${formatted}`;
}



// --- argument-type-mismatch shape: dynamic import().default pattern ---
declare function useTheme(): { resolvedTheme: string | undefined };

async function renderDiagram(source: string, theme: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
  });
  const { svg } = await mermaid.render(`diagram-${Date.now()}`, source);
  return svg;
}



// --- argument-type-mismatch shape: Lingui _(msg`...`) tagged-template call for i18n string ---
declare function msg(strings: TemplateStringsArray, ...values: any[]): { id: string };
declare function useLingui(): { _: (descriptor: { id: string }) => string };
declare const CommandInput: any;

function LocaleSearchInput() {
  const { _ } = useLingui();
  return <CommandInput placeholder={_(msg`Search locales...`)} />;
}



// --- argument-type-mismatch shape: useHotkeys with array of key combos and event handler ---
declare function useHotkeys(keys: string[], handler: (event: KeyboardEvent) => void, opts?: object): void;

function useCanvasKeyboardShortcuts({
  onCopy,
  onPaste,
  onDuplicate,
}: {
  onCopy: (evt: KeyboardEvent) => void;
  onPaste: (evt: KeyboardEvent) => void;
  onDuplicate: (evt: KeyboardEvent) => void;
}) {
  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onCopy(evt));
  useHotkeys(['ctrl+v', 'meta+v'], (evt) => onPaste(evt));
  useHotkeys(['ctrl+d', 'meta+d'], (evt) => onDuplicate(evt));
}



// --- shape da7ad25224e2: i18n translation call used as JSX Preview child ---
declare function useLingui(): { _: (msg: unknown) => string };
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare const Preview: (props: { children: string }) => JSX.Element;

function ConfirmationEmailPreview() {
  const { _ } = useLingui();
  const previewText = msg`Please confirm your account`;
  return <Preview>{_(previewText)}</Preview>;
}



// --- shape dafd0d548b6a: zod string min with message id from msg template ---
declare const z: {
  object: (shape: Record<string, unknown>) => { array: () => { min: (n: number, opts: { message: string }) => unknown } };
  string: () => { min: (n: number, opts: { message: string }) => unknown; optional: () => unknown };
};
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string };

const ZOptionSchema = z.object({
  value: z.string().min(1, {
    message: msg`Option value cannot be empty`.id,
  }),
});



// --- shape db06d38371b2: tRPC useMutation with onSuccess side effects ---
declare const trpc: {
  document: {
    saveAsTemplate: {
      useMutation: (opts: {
        onSuccess: (result: { id: number }) => Promise<void>;
      }) => { mutateAsync: (args: unknown) => Promise<{ id: number }>; isPending: boolean };
    };
  };
};
declare function navigate(path: string): Promise<void>;
declare function toast(opts: { title: string; description: string; duration: number }): void;
declare function setOpen(val: boolean): void;
declare const templatesPath: string;

const { mutateAsync: saveAsTemplate, isPending } = trpc.document.saveAsTemplate.useMutation({
  onSuccess: async ({ id }) => {
    toast({
      title: 'Template Created',
      description: 'Your document has been saved as a template.',
      duration: 5000,
    });
    await navigate(`${templatesPath}/${id}/edit`);
    setOpen(false);
  },
});



// tRPC useQuery with initialData from array.map()
declare function useOrganisationsQuery(opts: { initialData: Array<{ id: string; name: string; role: string }> }): { data: Array<{ id: string; name: string; role: string }>; isLoading: boolean };
declare const sessionOrgs: Array<{ id: string; name: string }>;

function useOrganisationList() {
  const { data, isLoading } = useOrganisationsQuery({
    initialData: sessionOrgs.map((org) => ({
      ...org,
      role: 'member',
    })),
  });
  return { data, isLoading };
}



// tRPC useQuery with debounced input value
declare function useDebouncedValue<T>(value: T, delay: number): T;
declare function useSearchQuery(opts: { query: string; page: number; perPage: number; placeholderData: (prev: unknown) => unknown }): { data: unknown; isPending: boolean };

function useSearchItems(rawQuery: string, page: number): { data: unknown; isPending: boolean } {
  const debouncedQuery = useDebouncedValue(rawQuery, 500);
  return useSearchQuery({
    query: debouncedQuery,
    page,
    perPage: 20,
    placeholderData: (previousData) => previousData,
  });
}



// useHotkeys with extra options object {duplicate:true}
declare function useHotkeys(keys: string | string[], handler: (evt: KeyboardEvent) => void, deps?: unknown[]): void;
declare function useHotkeys(keys: string | string[], handler: (evt: KeyboardEvent, options: Record<string, unknown>) => void, options: Record<string, boolean>, deps?: unknown[]): void;

declare function onFieldCopy(evt: KeyboardEvent, opts?: { duplicate?: boolean }): void;
declare function onFieldPaste(evt: KeyboardEvent): void;

function registerFieldHotkeys(): void {
  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onFieldCopy(evt));
  useHotkeys(['ctrl+v', 'meta+v'], (evt) => onFieldPaste(evt));
  useHotkeys(['ctrl+d', 'meta+d'], (evt) => onFieldCopy(evt, { duplicate: true }));
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// argument-type-mismatch FP: typed useRef initialization with null
declare function useRef<T>(initial: T): { current: T };

function useTimerRef(): { current: ReturnType<typeof setTimeout> | null } {
  return useRef<ReturnType<typeof setTimeout> | null>(null);
}

export { useTimerRef };



// argument-type-mismatch FP: tRPC useQuery with empty input object and config
interface QueryConfig { enabled?: boolean; staleTime?: number }
interface QueryResult<T> { data: T | undefined; isLoading: boolean }
declare const api: {
  template: {
    list: { useQuery: (input: Record<string, never>, config?: QueryConfig) => QueryResult<unknown[]> };
  };
};

function usePublicTemplates(enabled: boolean) {
  return api.template.list.useQuery({}, { enabled, staleTime: 60_000 });
}

export { usePublicTemplates };



// argument-type-mismatch FP: custom hook call with callback and data args
interface PageData { width: number; height: number; scale: number }
declare function usePageRenderer(
  onRender: (canvas: HTMLCanvasElement) => void,
  pageData: PageData
): { canvasRef: { current: HTMLCanvasElement | null } };

function FieldsPageRenderer({ pageData }: { pageData: PageData }) {
  const { canvasRef } = usePageRenderer(
    (canvas) => { canvas.getContext('2d'); },
    pageData
  );
  return canvasRef;
}

export { FieldsPageRenderer };



// argument-type-mismatch FP: tRPC procedure chain .input().output().query()
declare const z: { object: (s: object) => unknown; string: () => unknown; enum: <T extends string[]>(v: T) => unknown };
declare const publicProcedure: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      query: (fn: (opts: { input: unknown }) => unknown) => unknown;
    };
  };
};
declare function getEnvelopeStatus(id: string): Promise<string>;

const signingStatusProcedure = publicProcedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ status: z.enum(['PENDING', 'SIGNED', 'DECLINED']) }))
  .query(async ({ input }) => {
    const status = await getEnvelopeStatus(input as string);
    return { status };
  });

export { signingStatusProcedure };



// argument-type-mismatch FP: tRPC splitLink with true: httpLink config object
declare function splitLink(config: {
  condition: (op: { type: string }) => boolean;
  true: unknown;
  false: unknown;
}): unknown;
declare function httpLink(opts: { url: string; headers?: () => Record<string, string> }): unknown;
declare function wsLink(opts: { url: string }): unknown;

const trpcLink = splitLink({
  condition: (op) => op.type === 'subscription',
  true: wsLink({ url: '/api/trpc/ws' }),
  false: httpLink({ url: '/api/trpc' }),
});

export { trpcLink };


// SelectValue with i18n tagged template as placeholder prop — no type mismatch.
declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;
declare function SelectValue(props: { placeholder: string }): unknown;

function NumericFieldPlaceholder() {
  return SelectValue({ placeholder: t`Enter a number` });
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// --- void-zero-argument FP shape: navigate-with-ternary-options (void <call_expression> promise-discard) ---
declare function useNavigate(): (path: string, opts?: { replace?: boolean }) => Promise<void>;

function buildQueryString(params: { locale?: string; page?: number; filter?: string }): string {
  const parts: string[] = [];
  if (params.locale) parts.push(`locale=${params.locale}`);
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.filter) parts.push(`filter=${encodeURIComponent(params.filter)}`);
  return parts.join('&');
}

function SearchFilterPanel({ locale, page, filter }: { locale?: string; page?: number; filter?: string }) {
  const navigate = useNavigate();

  const onApplyFilters = () => {
    const qs = buildQueryString({ locale, page, filter });
    void navigate(qs ? `?${qs}` : '.', { replace: true });
  };

  return { onApplyFilters };
}



// --- void-zero-argument FP shape: autosave-on-remove (void handleAutoSave() fire-and-forget) ---
declare function handleAutoSave(): Promise<void>;
declare function removeRecipient(index: number): void;
declare function normalizeOrder<T>(items: T[]): T[];

function onRemoveRecipient(index: number, recipients: { id: string; email: string }[]) {
  removeRecipient(index);
  const updated = recipients.filter((_, idx) => idx !== index);
  const normalized = normalizeOrder(updated);
  void handleAutoSave();
}



// --- void-zero-argument FP shape: navigate-simple-path (void navigate(path) promise-discard) ---
declare function useNavigate(): (path: string) => Promise<void>;

interface CommandItem {
  id: string;
  label: string;
  href: string;
}

function CommandMenu({ items }: { items: CommandItem[] }) {
  const navigate = useNavigate();

  const onSelectCommand = (item: CommandItem) => {
    void navigate(item.href);
  };

  return { onSelectCommand };
}



// --- void-zero-argument FP shape: bulk-delete-action (void bulkDelete({...}) in event handler) ---
declare function bulkDeleteItems(opts: { ids: string[]; reason?: string }): Promise<void>;
declare function onClose(): void;

function BulkDeleteDialog({ selectedIds, onClose: closeDialog }: { selectedIds: string[]; onClose: () => void }) {
  const handleDelete = () => {
    void bulkDeleteItems({ ids: selectedIds, reason: 'user-requested' });
    closeDialog();
  };
  return { handleDelete };
}



// --- void-zero-argument FP shape: onclick-download-cert (void onDownloadCertificatesClick() in onClick) ---
declare function downloadCertificates(documentId: string): Promise<void>;

function DocumentCertificateDownloadButton({ documentId }: { documentId: string }) {
  const onDownloadCertificatesClick = async () => {
    await downloadCertificates(documentId);
  };

  return {
    onClick: () => void onDownloadCertificatesClick(),
  };
}



// --- void-zero-argument FP shape: onclick-subscribe (void onSubscribeClick() in onClick prop) ---
declare function initiateCheckout(planId: string, currency: string): Promise<void>;

interface PlanCardProps {
  planId: string;
  currency: string;
  label: string;
}

function PlanCard({ planId, currency, label }: PlanCardProps) {
  const onSubscribeClick = async () => {
    await initiateCheckout(planId, currency);
  };

  return {
    onClick: () => void onSubscribeClick(),
    label,
  };
}



// --- void-zero-argument FP shape: navigate-after-dialog-close (void navigate(path) after mutation) ---
declare function useNavigate(): (path: string) => Promise<void>;
declare function moveItemToFolder(opts: { itemId: string; folderId: string }): Promise<void>;

function MoveFolderDialog({ itemId, folderId, basePath }: { itemId: string; folderId: string; basePath: string }) {
  const navigate = useNavigate();

  const onSubmit = async () => {
    await moveItemToFolder({ itemId, folderId });
    const targetPath = `${basePath}?folder=${folderId}`;
    void navigate(targetPath);
  };

  return { onSubmit };
}



// --- void-zero-argument FP shape: useeffect-session-refresh (void refreshSession() in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function refreshSession(): Promise<void>;
declare function onSessionExpired(handler: () => void): () => void;

function SessionProvider({ children }: { children: unknown }) {
  useEffect(() => {
    const cleanup = onSessionExpired(() => {
      void refreshSession();
    });
    return cleanup;
  }, []);

  return children;
}



// --- void-zero-argument FP shape: navigate-replace-with-params (void navigate(template, {replace}) promise-discard) ---
declare function useNavigate(): (path: string, opts?: { replace?: boolean }) => Promise<void>;

function DocumentEditPage({ teamSlug, documentId }: { teamSlug: string; documentId: string }) {
  const navigate = useNavigate();

  const onDocumentIdMismatch = (resolvedId: string) => {
    void navigate(`/t/${teamSlug}/documents/${resolvedId}/edit`, { replace: true });
  };

  return { onDocumentIdMismatch };
}



// --- void-zero-argument FP shape: autosave-on-settings-change (void handleAutoSave() on settings change) ---
declare function handleAutoSave(): Promise<void>;
declare function updateLocalSettings(settings: Record<string, unknown>): void;

function SettingsPanel({ initialSettings }: { initialSettings: Record<string, unknown> }) {
  const onSettingChange = (key: string, value: unknown) => {
    updateLocalSettings({ [key]: value });
    void handleAutoSave();
  };

  return { onSettingChange };
}



// --- void-zero-argument FP shape: onclick-rename-dialog (void onRename() in onClick handler) ---
declare function renameItem(itemId: string, newName: string): Promise<void>;
declare function onDialogClose(): void;

function RenameDialog({ itemId, newName, onClose }: { itemId: string; newName: string; onClose: () => void }) {
  const onRename = async () => {
    await renameItem(itemId, newName);
    onClose();
  };

  return {
    onClick: () => void onRename(),
  };
}



// --- void-zero-argument FP shape: form-trigger-validation (void form.trigger('field') promise-discard) ---
declare function useForm<T>(): {
  trigger: (field: keyof T) => Promise<boolean>;
  getValues: () => T;
};

interface RecipientForm {
  recipients: Array<{ email: string; name: string }>;
  signingOrder: 'sequential' | 'parallel';
}

function RecipientFormPanel() {
  const form = useForm<RecipientForm>();

  const onRecipientChange = () => {
    void form.trigger('recipients');
  };

  return { onRecipientChange };
}



// --- void-zero-argument FP shape: optional-callback-discard (void onSearch?.(term) optional async callback) ---
declare function useDebounce<T>(value: T, delay: number): T;

interface MultiSelectProps {
  options: Array<{ value: string; label: string }>;
  onSearch?: (term: string) => Promise<void>;
}

function MultiSelect({ options, onSearch }: MultiSelectProps) {
  const debouncedTerm = useDebounce('', 300);

  const handleSearch = (term: string) => {
    void onSearch?.(term);
  };

  return { handleSearch, options };
}



// --- void-zero-argument FP shape: step-change-handler (void handleStepChange(id) promise-discard) ---
declare function handleStepChange(stepId: string): Promise<void>;

interface WorkflowStep {
  id: string;
  label: string;
  completed: boolean;
}

function WorkflowEditor({ steps }: { steps: WorkflowStep[] }) {
  const onStepClick = (step: WorkflowStep) => {
    const targetStep = steps.find((s) => s.id === step.id);
    if (targetStep) {
      void handleStepChange(targetStep.id);
    }
  };

  return { onStepClick };
}



// --- void-zero-argument FP shape: useeffect-refetch-data (void refetchDocument() fire-and-forget in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function refetchDocument(): Promise<void>;
declare function subscribeToDocumentUpdates(docId: string, cb: () => void): () => void;

function DocumentEditForm({ documentId }: { documentId: string }) {
  useEffect(() => {
    const unsubscribe = subscribeToDocumentUpdates(documentId, () => {
      void refetchDocument();
    });
    return unsubscribe;
  }, [documentId]);
}



// --- void-zero-argument FP shape: resend-email-action (void resendEmailVerification({teamId}) fire-and-forget) ---
declare function resendEmailVerification(opts: { teamId: string }): Promise<void>;
declare function showToast(msg: string): void;

function TeamEmailDropdown({ teamId }: { teamId: string }) {
  const handleResendVerification = () => {
    void resendEmailVerification({ teamId });
  };

  return { handleResendVerification };
}



// --- void-zero-argument FP shape: framer-motion-animate (void animate(motionValue, target, opts) fire-and-forget) ---
declare function animate(value: unknown, target: number, opts: { duration: number; ease?: string }): Promise<void>;
declare function useMotionValue(initial: number): unknown;

function AnimatedCard({ isActive }: { isActive: boolean }) {
  const cardX = useMotionValue(100);
  const sheenOpacity = useMotionValue(0.8);

  const onActivate = () => {
    void animate(cardX, 0, { duration: 0.4, ease: 'easeOut' });
    void animate(sheenOpacity, 0, { duration: 0.3 });
  };

  return { onActivate };
}



// --- void-zero-argument FP shape: navigate-to-step (void navigateToStep('upload') in onClick) ---
declare function navigateToStep(stepName: string): Promise<void>;

interface UploadStepButtonProps {
  currentStep: string;
}

function FieldsPageNavigation({ currentStep }: UploadStepButtonProps) {
  const onBackToUpload = () => {
    void navigateToStep('upload');
  };

  return { onBackToUpload, currentStep };
}



// --- void-zero-argument FP shape: callback-prop-form-submit (onGoNextClick={() => void onFormSubmit()}) ---
declare function onFormSubmit(): Promise<void>;

interface StepNavigationProps {
  onGoNextClick: () => void;
  label: string;
}

function StepNavigationBar({ label }: { label: string }): StepNavigationProps {
  return {
    label,
    onGoNextClick: () => void onFormSubmit(),
  };
}



// --- void-zero-argument FP shape: useeffect-auth-procedure (void executeActionAuthProcedure({...}) in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function executeActionAuthProcedure(opts: { actionId: string; recipientId: string }): Promise<void>;

function ActionAuthRenderer({ actionId, recipientId }: { actionId: string; recipientId: string }) {
  useEffect(() => {
    void executeActionAuthProcedure({ actionId, recipientId });
  }, [actionId, recipientId]);
}



// --- void-zero-argument FP shape: trpc-cache-invalidation (void utils.query.invalidate({...}) fire-and-forget) ---
declare const utils: {
  document: {
    attachment: {
      list: {
        invalidate(opts: { documentId: string }): Promise<void>;
      };
    };
  };
};

function AttachmentsPopover({ documentId }: { documentId: string }) {
  const onAttachmentUploaded = () => {
    void utils.document.attachment.list.invalidate({ documentId });
  };

  return { onAttachmentUploaded };
}



// --- void-zero-argument FP shape: i18n-activate-finally-chain (void dynamicActivate(lang).finally(...)) ---
declare function dynamicActivate(locale: string): Promise<void>;
declare function setLocaleReady(ready: boolean): void;

function I18nInitializer({ language }: { language: string }) {
  const onLanguageSelect = (lang: string) => {
    void dynamicActivate(lang).finally(() => {
      setLocaleReady(true);
    });
  };

  return { onLanguageSelect };
}



// --- void-zero-argument FP shape: autosave-on-drag-end (void handleAutoSave() after drag-end reorder) ---
declare function handleAutoSave(): Promise<void>;
declare function reorderRecipients(fromIndex: number, toIndex: number): void;

function RecipientDragList({ count }: { count: number }) {
  const onDragEnd = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    reorderRecipients(fromIndex, toIndex);
    void handleAutoSave();
  };

  return { onDragEnd, count };
}



// --- void-zero-argument FP shape: autosave-on-field-add (void handleAutoSave() after adding a field) ---
declare function handleAutoSave(): Promise<void>;
declare function appendField(field: { type: string; label: string }): void;

function TemplateFieldsEditor() {
  const onAddField = (fieldType: string, label: string) => {
    appendField({ type: fieldType, label });
    void handleAutoSave();
  };

  return { onAddField };
}



// --- void-zero-argument FP shape: onclick-submit-with-object-arg (void onFormSubmit({bytes: null}) in onClick) ---
declare function onFormSubmit(data: { bytes: Uint8Array | null; fileName?: string }): Promise<void>;

function AvatarImageEditor({ fileName }: { fileName?: string }) {
  return {
    onRemoveAvatar: () => void onFormSubmit({ bytes: null, fileName }),
  };
}



// --- void-zero-argument FP shape: navigate-to-addfields-step (void navigateToStep('addFields') in onClick) ---
declare function navigateToStep(stepName: string): Promise<void>;

function UploadPageNavigation() {
  const onContinueToFields = () => {
    void navigateToStep('addFields');
  };

  return { onContinueToFields };
}



// --- void-zero-argument FP shape: sign-field-action (void signField(id, {...}) fire-and-forget in event handler) ---
declare function signField(fieldId: string, opts: { signature: string; authToken: string }): Promise<void>;

interface SignatureField {
  id: string;
  type: 'signature' | 'initials' | 'date';
}

function SignerFieldRenderer({ field, authToken }: { field: SignatureField; authToken: string }) {
  const onSignatureAccepted = (signature: string) => {
    void signField(field.id, { signature, authToken });
  };

  return { onSignatureAccepted };
}



// --- void-zero-argument FP shape: async-callback-refresh-limits (void refreshLimits() in async callback) ---
declare function refreshLimits(): Promise<void>;
declare function deleteItem(itemId: string): Promise<void>;

async function onDeleteConfirmed(itemId: string, onSuccess?: () => void) {
  await deleteItem(itemId);
  void refreshLimits();
  onSuccess?.();
}



// --- void-zero-argument FP shape: onclick-delete-with-object (void deleteEnvelope({...}) in onClick handler) ---
declare function deleteEnvelope(opts: { envelopeId: string; teamId?: string }): Promise<void>;
declare function onClose(): void;

function EnvelopeDeleteDialog({ envelopeId, teamId }: { envelopeId: string; teamId?: string }) {
  return {
    onClick: () => {
      void deleteEnvelope({ envelopeId, teamId });
      onClose();
    },
  };
}



// --- void-zero-argument FP shape: autosave-on-field-remove (void handleAutoSave() after field removal) ---
declare function handleAutoSave(): Promise<void>;
declare function removeField(fieldId: string): void;

function FieldsEditor({ fields }: { fields: Array<{ id: string; label: string }> }) {
  const onRemoveField = (fieldId: string) => {
    removeField(fieldId);
    void handleAutoSave();
  };

  return { onRemoveField };
}



// --- void-zero-argument FP shape: onclick-delete-link (void deleteTemplateDirectLink({...}) in onClick) ---
declare function deleteTemplateDirectLink(opts: { templateId: string; linkId: string }): Promise<void>;

function DirectLinkDialog({ templateId, linkId }: { templateId: string; linkId: string }) {
  return {
    onDeleteLink: () => void deleteTemplateDirectLink({ templateId, linkId }),
  };
}



// --- void-zero-argument FP shape: onclick-refetch-passkeys (void refetchPasskeys() in onClick) ---
declare function refetchPasskeys(): Promise<void>;

function PasskeyAuthPanel() {
  return {
    onRefreshPasskeys: () => void refetchPasskeys(),
  };
}



// --- void-zero-argument FP shape: file-drop-callback (void onFileDrop(files) in dropzone callback) ---
declare function onFileDrop(files: File[]): Promise<void>;

interface DropzoneConfig {
  onDrop: (files: File[]) => void;
  accept: string[];
  maxFiles: number;
}

function DocumentUploadDropzone(): DropzoneConfig {
  return {
    accept: ['application/pdf'],
    maxFiles: 1,
    onDrop: (files) => {
      void onFileDrop(files);
    },
  };
}



// --- void-zero-argument FP shape: autosave-on-signer-reorder (void handleAutoSave() after signer reorder) ---
declare function handleAutoSave(): Promise<void>;
declare function reorderSigners(from: number, to: number): void;

function SignersListEditor() {
  const onSignerDragEnd = (fromIndex: number, toIndex: number) => {
    reorderSigners(fromIndex, toIndex);
    void handleAutoSave();
  };

  return { onSignerDragEnd };
}



// --- void-zero-argument FP shape: framer-motion-sheen (void animate(sheenOpacity, 0, opts) Framer Motion) ---
declare function animate(value: unknown, target: number, opts: { duration: number }): Promise<void>;
declare function useMotionValue(initial: number): unknown;

function SheenAnimationCard({ isVisible }: { isVisible: boolean }) {
  const sheenOpacity = useMotionValue(0.6);
  const cardX = useMotionValue(80);

  const onHide = () => {
    void animate(cardX, 0, { duration: 0.35 });
    void animate(sheenOpacity, 0, { duration: 0.25 });
  };

  return { onHide };
}



// --- void-zero-argument FP shape: useeffect-render-low-res (void renderAtResolution(LOW_RES) in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function renderAtResolution(dpr: number): Promise<void>;

const LOW_RENDER_RESOLUTION = 1;
const HIGH_RENDER_RESOLUTION = 2;

function PdfPageViewer({ pageIndex, isVisible }: { pageIndex: number; isVisible: boolean }) {
  useEffect(() => {
    if (!isVisible) return;
    void renderAtResolution(LOW_RENDER_RESOLUTION);
    void renderAtResolution(HIGH_RENDER_RESOLUTION);
  }, [pageIndex, isVisible]);
}



// --- void-zero-argument FP shape: replace-pdf-handler (void onReplacePdf(id, file) promise-discard) ---
declare function onReplacePdf(itemId: string, file: File): Promise<void>;

function PdfUploadItem({ itemId }: { itemId: string }) {
  const onFileInputChange = (event: { target: { files: FileList | null } }) => {
    const file = event.target.files?.[0];
    if (file) {
      void onReplacePdf(itemId, file);
    }
  };

  return { onFileInputChange };
}



// --- void-zero-argument FP shape: useeffect-render-high-res (void renderAtResolution(HIGH_RES) separate call) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function renderAtResolution(dpr: number): Promise<void>;

const PREVIEW_RESOLUTION = 1.5;
const PRINT_RESOLUTION = 3;

function HighResPageRenderer({ pageIndex, isPrintMode }: { pageIndex: number; isPrintMode: boolean }) {
  useEffect(() => {
    const resolution = isPrintMode ? PRINT_RESOLUTION : PREVIEW_RESOLUTION;
    void renderAtResolution(resolution);
  }, [pageIndex, isPrintMode]);
}



// --- void-zero-argument FP shape: drop-zone-callback-prop (onDrop: (files) => void onFileDrop(files)) ---
declare function onFileDrop(files: File[]): Promise<void>;

interface DropZoneWrapperProps {
  label: string;
  accept: string[];
  onDrop: (files: File[]) => void;
}

function buildDropZoneProps(label: string): DropZoneWrapperProps {
  return {
    label,
    accept: ['application/pdf', 'image/*'],
    onDrop: (files) => void onFileDrop(files),
  };
}



// --- void-zero-argument FP shape: dropzone-ondrop-callback (void onDrop(acceptedFiles) in dropzone onDrop) ---
declare function onDrop(files: File[]): Promise<void>;
declare function useDropzone(opts: { onDrop: (files: File[]) => void; accept: Record<string, string[]> }): { getRootProps: () => Record<string, unknown>; isDragActive: boolean };

function DocumentDropzone() {
  const { getRootProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    onDrop: (acceptedFiles) => {
      void onDrop(acceptedFiles);
    },
  });

  return { getRootProps, isDragActive };
}



// --- void-zero-argument FP shape: throttle-fn-complete-click (void onCompleteClick() inside throttle fn) ---
declare function useThrottleFn(fn: () => void, delay: number): () => void;
declare function onCompleteClick(): Promise<void>;

function EmbedTemplateCompletionButton() {
  const handleComplete = useThrottleFn(() => {
    void onCompleteClick();
  }, 1000);

  return { handleComplete };
}



// --- void-zero-argument FP shape: onclick-navigate-step-id (void navigateToStep(step.id) in onClick) ---
declare function navigateToStep(stepId: string): Promise<void>;

interface EditorStep {
  id: string;
  label: string;
  index: number;
}

function EditorStepSidebar({ steps }: { steps: EditorStep[] }) {
  const onStepClick = (step: EditorStep) => {
    void navigateToStep(step.id);
  };

  return { onStepClick, steps };
}



// --- void-zero-argument FP shape: useeffect-font-load-chain (void document.fonts.ready.then(...) in useEffect) ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function renderPage(): Promise<void>;
declare const documentFonts: { ready: Promise<void> };

function PageRendererHook({ pageId }: { pageId: string }) {
  useEffect(() => {
    void documentFonts.ready.then(() => {
      void renderPage();
    });
  }, [pageId]);
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// Standard HTTP 404 throw in a single embed sign route; standalone usage
declare const params: { token?: string };

export function validateEmbedToken() {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }
  return params.token;
}



// Toast variant 'destructive' in a single upload page; standalone API vocabulary usage
declare function useToast(): { toast: (opts: { title: string; variant: string }) => void };

export function notifyUploadError(message: string) {
  const { toast } = useToast();
  toast({ title: message, variant: 'destructive' });
}



// Toast variant 'destructive' in a single template edit form; standalone protocol API vocabulary
declare function showToast(opts: { title: string; description: string; variant: string }): void;

export function notifyTemplateError(err: Error) {
  showToast({
    title: 'Save failed',
    description: err.message,
    variant: 'destructive',
  });
}



// Single email-password route file defines POST /authorize endpoint; standalone route path string
declare const router: { post: (path: string, handler: (...args: unknown[]) => unknown) => void };

router.post('/authorize', async (ctx) => {
  return { status: 200 };
});



// UI component variant strings ('default', 'destructive') are standard API values; not duplicated logic
declare function showToast(opts: { title: string; variant: string }): void;

export function notifyMoveSuccess() {
  showToast({ title: 'Moved successfully', variant: 'default' });
}

export function notifyMoveError() {
  showToast({ title: 'Move failed', variant: 'destructive' });
}



// Single OAuth route file defines POST /authorize/google endpoint; standalone route path
declare const oauthRouter: { post: (path: string, handler: (...args: unknown[]) => unknown) => void };

oauthRouter.post('/authorize/google', async (ctx) => {
  return { redirectUrl: 'https://accounts.google.com/o/oauth2/auth' };
});



// Single sheet primitive sets defaultVariants {position: 'right'}; one usage in CVA/cva declaration
declare function cva(base: string, opts: { variants: object; defaultVariants: object }): (opts: object) => string;

export const sheetVariants = cva('fixed inset-y-0 z-50', {
  variants: {
    position: {
      left: 'left-0',
      right: 'right-0',
    },
  },
  defaultVariants: {
    position: 'right',
  },
});



// Single select primitive uses position = 'popper' as a default; one usage
declare function SelectContent(props: { position?: string; children: unknown }): unknown;

export function DropdownContent({ children, position = 'popper' }: { children: unknown; position?: string }) {
  return SelectContent({ position, children });
}



// Two parallel Hono route handlers call sValidator('param', ...) with different schema args
declare function sValidator(location: string, schema: unknown): unknown;
declare const z: { object: (s: Record<string, unknown>) => unknown; string: () => unknown };
declare const honoApp: { get: (path: string, ...middleware: unknown[]) => void };

honoApp.get('/download/:fileId', sValidator('param', z.object({ fileId: z.string() })), async (ctx) => {
  return { ok: true };
});

honoApp.get('/preview/:previewId', sValidator('param', z.object({ previewId: z.string() })), async (ctx) => {
  return { ok: true };
});



// Two OpenAPI route definitions each specify their own tag array; API metadata specific to each router
declare function defineRoute(opts: { method: string; path: string; tags: string[]; handler: () => unknown }): void;

defineRoute({
  method: 'GET',
  path: '/fields',
  tags: ['Fields'],
  handler: async () => ({ fields: [] }),
});

defineRoute({
  method: 'POST',
  path: '/fields',
  tags: ['Fields'],
  handler: async () => ({ created: true }),
});



// Single file helper sets ETag header; 'ETag' is a standard HTTP header name used once
declare const response: { headers: { set: (name: string, value: string) => void } };
declare function computeETag(content: string): string;

export function attachETagHeader(content: string) {
  const etag = computeETag(content);
  response.headers.set('ETag', etag);
}



// Single button primitive sets defaultVariants {variant: 'default'}; CVA declaration, one usage
declare function cva(base: string, opts: { variants: object; defaultVariants: object }): (opts: object) => string;

export const buttonVariants = cva('inline-flex items-center justify-center rounded-md', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      destructive: 'bg-destructive text-destructive-foreground',
      outline: 'border border-input',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});



// Single 2FA route file defines POST /enable endpoint; standalone route string
declare const twoFactorRouter: { post: (path: string, handler: (...args: unknown[]) => unknown) => void };

twoFactorRouter.post('/enable', async (ctx) => {
  return { enabled: true };
});

twoFactorRouter.post('/disable', async (ctx) => {
  return { enabled: false };
});



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// useForm with config object literal
declare function useForm<T>(config: { defaultValues: T; mode: string }): { register: (name: string) => object; handleSubmit: (fn: (data: T) => void) => (e: Event) => void };

type ContactForm = { name: string; email: string; message: string };

function setupContactForm() {
  const form = useForm<ContactForm>({
    defaultValues: { name: '', email: '', message: '' },
    mode: 'onBlur',
  });
  return form;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// useForm with zodResolver in config object
declare function zodResolver<T>(schema: T): (values: unknown) => { values: unknown; errors: Record<string, unknown> };
declare function useForm<T>(config: { resolver: ReturnType<typeof zodResolver>; defaultValues: T }): { register: (name: string) => object };
declare const inviteSchema: { parse: (v: unknown) => { email: string; role: string } };

function setupInviteForm() {
  const form = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'viewer' },
  });
  return form;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Ternary inside resolver arg in form setup — idiomatic, not complex
declare function useForm<T>(options: { resolver: unknown; defaultValues: Partial<T> }): { handleSubmit: unknown };
declare function zodResolver(schema: unknown): unknown;
declare const ZConfigureTemplateSchema: unknown;
declare const ZConfigureDocumentSchema: unknown;
declare type ConfigureView = 'template' | 'document';
export function useConfigureDocumentForm(viewType: ConfigureView) {
  return useForm({
    resolver: zodResolver(viewType === 'template' ? ZConfigureTemplateSchema : ZConfigureDocumentSchema),
    defaultValues: {},
  });
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// Hono-style context responses — HTTP status codes are well-known constants, not magic numbers

declare const c: {
  text(body: string, status?: number): Response;
  json(body: unknown, status?: number): Response;
  redirect(location: string, status?: number): Response;
};

export function blockSuspiciousAccount(email: string, suspiciousEmails: ReadonlySet<string>): Response {
  if (suspiciousEmails.has(email.toLowerCase())) {
    return c.text('FORBIDDEN', 403);
  }
  return c.json({ error: 'Not found' }, 404);
}

export function enforceAuthentication(isLoggedIn: boolean, returnPath: string): Response {
  if (!isLoggedIn) {
    return c.redirect(`/login?next=${encodeURIComponent(returnPath)}`, 401);
  }
  return c.json({ authenticated: true }, 200);
}



// Zod schema with named field-length constraints — numeric literals inside
// .max()/.min() calls on a zod chain are schema-validation constraints, not
// magic numbers, and must not be flagged.
declare const z: any;

const ZProfileSettingsSchema = z.object({
  displayName: z.string().max(80).optional(),
  bio: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  organizationName: z.string().min(2).max(200).optional(),
});

export type TProfileSettingsSchema = typeof ZProfileSettingsSchema;



// E2E helper: stabilize UI after dropdown toggle before asserting menu state
declare const testPage: { waitForTimeout(ms: number): Promise<void>; keyboard: { press(key: string): Promise<void> } };

export async function openContextMenu(
  triggerEl: { focus(): Promise<void>; click(): Promise<void> },
): Promise<void> {
  await testPage.waitForTimeout(500);
  await triggerEl.focus();
  await testPage.keyboard.press('Enter');

  await testPage.waitForTimeout(500);
  await testPage.keyboard.press('Escape');
  await testPage.waitForTimeout(500);

  await triggerEl.click();
}



// Throttled action handler — 500ms is a standard UI debounce for button clicks.
declare function useThrottleFn<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): [T, boolean];
declare function submitForm(): Promise<void>;

export function useFormSubmitThrottle() {
  const [throttledSubmit, isThrottled] = useThrottleFn(() => void submitForm(), 500);
  return { throttledSubmit, isThrottled };
}



// HTTP status codes passed directly to framework redirect/response helpers are
// standard and should not be flagged as magic numbers.
declare const ctx: {
  redirect(url: string, status?: number): Response;
  json(data: unknown, status?: number): Response;
};

export function redirectAfterLogin(destinationPath: string): Response {
  return ctx.redirect(destinationPath, 302);
}

export function redirectPermanently(destinationPath: string): Response {
  return ctx.redirect(destinationPath, 301);
}

export function sendNotFound(message: string): Response {
  return ctx.json({ error: message }, 404);
}



// Zod schema validation constraints — numeric literals inside .min()/.max()/.length()
// are named domain constraints, not magic numbers.

declare const z: {
  object: <T extends Record<string, unknown>>(shape: T) => { parse: (v: unknown) => unknown };
  string: () => { min: (n: number) => { max: (n: number) => { optional: () => unknown } }; max: (n: number) => unknown };
  number: () => { min: (n: number) => { max: (n: number) => unknown } };
};

const ZCreateApiKeySchema = z.object({
  keyName: z.string().min(3).max(64),
  description: z.string().max(255),
  expiresInDays: z.number().min(1).max(365),
});

export function parseApiKeyForm(raw: unknown): unknown {
  return ZCreateApiKeySchema.parse(raw);
}



// Zod schema validation constraints: numeric literals inside .min()/.max() are
// named token-length bounds, not magic numbers.
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => {
    min: (n: number, opts?: { message?: string }) => {
      max: (n: number, opts?: { message?: string }) => unknown;
    };
  };
};

const VerificationCodeSchema = (z as any).object({
  passcode: (z as any)
    .string()
    .min(6, { message: 'Passcode must be at least 6 characters long' })
    .max(8, { message: 'Passcode must be at most 8 characters long' }),
});

const ResetPinSchema = (z as any).object({
  pin: (z as any)
    .string()
    .min(4, { message: 'PIN must be at least 4 digits' })
    .max(4, { message: 'PIN must be exactly 4 digits' }),
});



// Zod schema validation constraints use numeric literals as named bounds —
// the magic-number rule must not flag .min()/.max() args on schema chains.

declare const zv: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => {
    min: (n: number, opts?: { message: string }) => any;
    max: (n: number, opts?: { message: string }) => any;
  };
};

const OtpCodeSchema = zv.object({
  code: zv
    .string()
    .min(6, { message: 'OTP code must be at least 6 characters long' })
    .max(8, { message: 'OTP code must be at most 8 characters long' }),
});



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// --- magic-string FP shape: framework-library-api (Zod discriminatedUnion key) ---
declare const z: {
  discriminatedUnion: (key: string, schemas: unknown[]) => unknown;
  object: (shape: Record<string, unknown>) => unknown;
  string: () => unknown;
  literal: (val: string) => unknown;
};

const authMethodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password'), hash: z.string() }),
  z.object({ type: z.literal('oauth'), provider: z.string() }),
]);



// --- magic-string FP shape: framework-library-api (TanStack Table column accessorKey) ---
type ColumnDef<T> = { accessorKey: keyof T & string; header: string };
type TeamMember = { name: string; email: string; role: string };

declare function createColumnHelper<T>(): { accessor: (key: keyof T & string, def: { header: string }) => ColumnDef<T> };

const columnHelper = createColumnHelper<TeamMember>();

const teamColumns: ColumnDef<TeamMember>[] = [
  { accessorKey: 'name', header: 'Member Name' },
  { accessorKey: 'email', header: 'Email Address' },
  { accessorKey: 'role', header: 'Role' },
];



// --- magic-string FP shape: framework-library-api (react-hook-form setError path) ---
declare function useForm<T>(): {
  setError: (field: keyof T | `root.${string}`, error: { type: string; message: string }, opts?: { shouldFocus?: boolean }) => void;
  handleSubmit: (fn: (data: T) => void) => () => void;
};
type RadioFormValues = { values: string[]; label: string };

function RadioFieldEditor() {
  const form = useForm<RadioFormValues>();
  function validateOptions(data: RadioFormValues) {
    if (data.values.length === 0) {
      form.setError('values' as keyof RadioFormValues, { type: 'manual', message: 'At least one option is required' });
    }
  }
  form.handleSubmit(validateOptions)();
}



// --- magic-string FP shape: framework-library-api (z.enum values matching typed enum) ---
declare const z: {
  enum: <T extends string>(values: [T, ...T[]]) => { parse: (val: unknown) => T; _type: T };
  object: (shape: Record<string, unknown>) => unknown;
};

const downloadVersionSchema = z.enum(['signed', 'original', 'pending']);
type DownloadVersion = typeof downloadVersionSchema._type;

declare function onDownload(version: DownloadVersion): void;

function DownloadPanel() {
  return {
    downloadOriginal: () => onDownload('original'),
    downloadSigned: () => onDownload('signed'),
    downloadPending: () => onDownload('pending'),
  };
}



// --- magic-string FP shape: framework-library-api (Radix UI typed default prop) ---
type PopperPosition = 'popper' | 'item-aligned';
type SelectContentProps = { children: unknown; position?: PopperPosition; className?: string };

declare function SelectContentPrimitive(props: SelectContentProps): unknown;

function SelectContent({ position = 'popper', className, children }: SelectContentProps) {
  return SelectContentPrimitive({ position, className, children });
}



// --- magic-string FP shape: framework-library-api (Framer Motion animation type value) ---
type MotionTransition = { type: 'spring' | 'tween' | 'inertia'; duration?: number; stiffness?: number; damping?: number };
declare function motion(config: { initial: Record<string, unknown>; animate: Record<string, unknown>; transition: MotionTransition }): unknown;

const dropzoneAnimation = motion({
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  transition: { type: 'spring', duration: 0.3, stiffness: 500 },
});



// --- magic-string FP shape: framework-library-api (ts-pattern .with discriminant) ---
declare function match<T>(val: T): {
  with: <P>(pattern: P, fn: () => unknown) => { with: <P2>(p: P2, fn2: () => unknown) => { otherwise: (fn: () => unknown) => unknown } };
};

type TokenValidationResult = 'invalid-token' | 'expired-token' | 'valid';
declare function validateSSOToken(token: string): TokenValidationResult;

function handleSSOConfirmation(token: string): string {
  const result = validateSSOToken(token);
  return match(result)
    .with('invalid-token', () => 'The token provided is invalid')
    .with('expired-token', () => 'The token has expired')
    .otherwise(() => 'Token is valid') as string;
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// Logger level strings are well-known constants defined by the logging library API — not magic strings.
declare function createLogger(opts: { level: string; transport?: { target: string; level: string } }): { info: (msg: string) => void };
declare function getEnv(key: string): string | undefined;

export const appLogger = createLogger({
  level: 'info',
  ...(getEnv('NODE_ENV') !== 'production' && {
    transport: {
      target: 'pino-pretty',
      level: 'info',
    },
  }),
});



// HTTP method strings in a ts-rest contract definition are standard protocol constants, not magic strings.
declare const z: { object: (shape: Record<string, unknown>) => unknown; string: () => unknown; number: () => unknown };

export const apiContract = {
  createAsset: {
    method: 'POST' as const,
    path: '/api/v1/assets',
    body: z.object({
      title: z.string(),
      size: z.number(),
    }),
    responses: {
      200: z.object({ id: z.string() }),
      401: z.object({ error: z.string() }),
    },
  },
  deleteAsset: {
    method: 'POST' as const,
    path: '/api/v1/assets/:id/delete',
    body: z.object({}),
    responses: {
      200: z.object({ success: z.string() }),
    },
  },
};




// --- magic-string shape: http-header-name-literal (req.headers.get) ---
declare function getRequest(): { headers: { get: (name: string) => string | null } };

export function getContentType(): string {
  const request = getRequest();
  return request.headers.get('content-type') || '';
}




// --- magic-string shape: font-family-literal (PDF rendering style) ---
declare function createPdfTextStyle(opts: { fontFamily: string; fontSize: number; color: string }): Record<string, unknown>;

export function buildDocumentTitleStyle(): Record<string, unknown> {
  return createPdfTextStyle({
    fontFamily: 'Inter',
    fontSize: 24,
    color: '#000000',
  });
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// TS 4.5+ inline type modifier in a combined import — valid, idiomatic TypeScript
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
declare module 'some-form-lib' {
  export const useForm: (config: unknown) => { register: (name: string) => unknown; handleSubmit: (fn: unknown) => unknown };
  export type FormConfig = { mode: 'onChange' | 'onBlur' | 'onSubmit' };
}

// Simulated import shape: import { useForm, type FormConfig } from 'some-form-lib'
type FormConfig = { mode: 'onChange' | 'onBlur' | 'onSubmit' };
declare const useForm: (config: FormConfig) => { register: (name: string) => unknown; handleSubmit: (fn: unknown) => unknown };

function buildSignatureForm(config: FormConfig) {
  const form = useForm(config);
  return form;
}



// TS 4.5+ inline type modifier: import { createCombobox, type ComboboxOption } from 'combobox-lib'
type ComboboxOption = { value: string; label: string };
declare const createCombobox: (options: ComboboxOption[]) => { select: (v: string) => void; selected: string | null };

function buildRecipientCombobox(recipients: ComboboxOption[]) {
  return createCombobox(recipients);
}



// TS 4.5+ inline type modifier: import { signDocument, type SigningField } from 'signing-lib'
type SigningField = { id: string; type: 'signature' | 'initials' | 'date'; required: boolean };
declare const signDocument: (docId: string, fields: SigningField[]) => Promise<void>;

async function processSigningForm(docId: string, fields: SigningField[]) {
  await signDocument(docId, fields.filter(f => f.required));
}



// --- no-void shape: void-with-promise-chain (.finally() in setTimeout — recursive cron poller) ---
declare const CRON_POLL_INTERVAL_MS_36f4: number;
declare const CRON_POLL_JITTER_MS_36f4: number;
declare function processCronTick_36f4(): Promise<void>;

let cronPoller_36f4: ReturnType<typeof setTimeout> | null = null;

const startCronPoller_36f4 = () => {
  if (cronPoller_36f4) {
    return;
  }

  const tick = () => {
    const jitter = Math.floor(Math.random() * CRON_POLL_JITTER_MS_36f4);

    cronPoller_36f4 = setTimeout(() => {
      void processCronTick_36f4().finally(tick);
    }, CRON_POLL_INTERVAL_MS_36f4 + jitter);
  };

  tick();
};



// --- no-void shape: module-level-or-non-react-async-init (void async IIFE at module top-level for conditional import) ---
declare let SkiaImageModule_5769: unknown;

void (async () => {
  if (typeof window === 'undefined') {
    const mod = await import('canvas');
    SkiaImageModule_5769 = (mod as { Image: unknown }).Image;
  }
})();



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// FP: void navigate() intentionally discards the navigation Promise — fire-and-forget pattern
declare function navigate(path: string, options?: { replace?: boolean }): Promise<void>;

export function redirectToHome(): void {
  void navigate('/home', { replace: true });
}

export function redirectAfterLogin(returnUrl: string): void {
  void navigate(returnUrl, { replace: true });
}



// shape: async function delegates to a mutation returning a Promise; async for trpc onSuccess handler type conformance
declare function updateSettingsData(opts: { templateId: string; data: Record<string, unknown> }): Promise<void>;
declare const settingsSchema: { safeParse(v: unknown): { success: boolean; data?: string[] } };

const saveTemplateSettings = async (data: { title: string; globalAccessAuth: unknown; externalId: string | null }) => {
  const parsedGlobalAccessAuth = settingsSchema.safeParse(data.globalAccessAuth);

  return updateSettingsData({
    templateId: 'template-id',
    data: {
      title: data.title,
      externalId: data.externalId || null,
      globalAccessAuth: parsedGlobalAccessAuth.success ? parsedGlobalAccessAuth.data : [],
    },
  });
};



// shape: async onClick handler delegates to fetchNextPage returning a Promise; async for React event handler type conformance
declare function fetchNextPage(): Promise<void>;
declare const isFetchingNextPage: boolean;

const ActivityFeedLoadMore = () => {
  return (
    // button onClick={async () => fetchNextPage()} — async required by onClick handler signature
    void 0
  );
};

// Standalone equivalent for the rule to fire:
const onLoadMoreClick = async () => fetchNextPage();



// shape: async onClick handler delegates to deleteClaim mutation returning a Promise; async for React event handler type conformance
declare function deleteClaim(opts: { id: string }): Promise<void>;
declare const claimId: string;
declare const claimLocked: boolean;

const onDeleteClaimClick = async () => deleteClaim({ id: claimId });



// shape: eslint-disable-next-line require-await; async arrow in useEffect void-invoked, delegates to sync search helper; async required by void exec() pattern
declare function doSearchSync(): void;
declare const onSearchSync: ((term: string) => void) | undefined;
declare const open: boolean;
declare const triggerSearchOnFocus: boolean;
declare const debouncedSearchTerm: string;

// eslint-disable-next-line @typescript-eslint/require-await
const execSearch = async () => {
  if (!onSearchSync || !open) {
    return;
  }

  if (triggerSearchOnFocus) {
    doSearchSync();
  }

  if (debouncedSearchTerm) {
    doSearchSync();
  }
};

void execSearch();



// shape: async onClick handler delegates to refetch returning a Promise; async for React Button onClick handler type conformance
declare function refetch(): Promise<void>;
declare const isFetching: boolean;

const onRefreshJobs = async () => refetch();



// shape: async onClearFilters callback delegates to navigate returning a Promise; async for DataTable callback type conformance
declare function navigate(path: string): Promise<void>;
declare const pathname: string | undefined;

const onClearSecurityFilters = async () => navigate(pathname ?? '/');



// shape: Hono middleware handler is async but only reads request fields and returns synchronously; async for Hono middleware signature conformance
declare interface HonoContext { req: { path: string } }

// eslint-disable-next-line @typescript-eslint/require-await
const handlePathRedirects = async (c: HonoContext): Promise<string | null> => {
  const { req } = c;
  const path = req.path;

  if (path === '/documents' || path === '/templates') {
    return '/';
  }

  return null;
};



// shape: async onClick handler delegates to handleCreatePortal returning a Promise; async for React Button onClick handler type conformance
declare function handleCreatePortal(): Promise<void>;

const onOpenBillingPortal = async () => handleCreatePortal();



// shape: async arrow passed to registerExternalFlush delegates to flushRef.current returning a Promise; async for flush callback type conformance
declare function registerExternalFlush(key: string, cb: () => Promise<void>): void;
declare const flushItemsRef: { current: () => Promise<void> };

// In a useEffect:
registerExternalFlush('uploadItems', async () => flushItemsRef.current());



// shape: async onSuccess callback delegates to refetchPasskeys returning a Promise; async for PasskeyCreateDialog onSuccess prop type conformance
declare function refetchPasskeys(): Promise<void>;

const onPasskeyCreated = async () => refetchPasskeys();



// shape: async onClick handler delegates to handleChangeAccount returning a Promise; async for React Button onClick handler type conformance
declare function handleChangeAccount(): Promise<void>;
declare const isSigningOut: boolean;

const onLoginButtonClick = async () => handleChangeAccount();



// shape: async onClick handler delegates to deleteTeamMember mutation returning a Promise; async for React Button onClick handler type conformance
declare function deleteTeamMember(opts: { teamId: string; memberId: string }): Promise<void>;
declare const teamId: string;
declare const memberId: string;
declare const isDeletingTeamMember: boolean;

const onRemoveMemberClick = async () => deleteTeamMember({ teamId, memberId });



// shape: async onClick handler delegates to onFormSubmit returning a Promise; async for React Button onClick handler type conformance
declare function onFormSubmit(): Promise<void>;
declare const isFormValid: boolean;
declare const isSubmitting: boolean;

const onSaveFieldsClick = async () => onFormSubmit();



// shape: async function delegates to addFields mutation returning a Promise; async for trpc mutation handler type conformance
declare function addFields(opts: { documentId: string; fields: unknown[] }): Promise<void>;
declare const document: { id: string; documentData: { envelopeItemId: string } };

const saveFieldsData = async (data: { fields: Array<{ nativeId: string; envelopeItemId?: string }> }) => {
  return addFields({
    documentId: document.id,
    fields: data.fields.map((field) => ({
      ...field,
      id: field.nativeId,
      envelopeItemId: document.documentData.envelopeItemId,
    })),
  });
};



// shape: async onClick handler delegates to deletePasskey mutation returning a Promise; async for React Button onClick handler type conformance
declare function deletePasskey(opts: { passkeyId: string }): Promise<void>;
declare const passkeyId: string;
declare const isDeletingPasskey: boolean;

const onDeletePasskeyClick = async () =>
  deletePasskey({
    passkeyId,
  });



// shape: Hono middleware is async but only calls sync helpers and returns next(); async for Hono middleware signature conformance
declare interface HonoCtx { req: { raw: Request }; }
declare function next(): Promise<void>;
declare function extractRequestMetadata(req: Request): Record<string, unknown>;
declare function setAppContext(c: HonoCtx, ctx: Record<string, unknown>): void;
declare function isPageRequest(req: Request): boolean;
declare const blacklistedPathsRegex: { test(path: string): boolean };

const appContext = async (c: HonoCtx) => {
  const request = c.req.raw;
  const url = new URL(request.url);

  setAppContext(c, {
    requestMetadata: extractRequestMetadata(request),
  });

  if (!isPageRequest(request) || blacklistedPathsRegex.test(url.pathname)) {
    return next();
  }

  return next();
};



// shape: async onClick handler delegates to onDownload returning a Promise; async for React Button onClick handler type conformance
declare function onDownload(item: { id: string }, version: string): Promise<void>;
declare const downloadItem: { id: string };

const onOriginalDownloadClick = async () => onDownload(downloadItem, 'original');
const onSignedDownloadClick = async () => onDownload(downloadItem, 'signed');



// shape: async onSelect handler delegates to setLanguage returning a Promise; async for CommandItem onSelect handler type conformance
declare function setLanguage(lang: string): Promise<void>;
declare const isLoading: boolean;

const onLanguageSelect = async (lang: string) => setLanguage(lang);



// shape: async onDrop handler delegates to onFileDrop returning a Promise; async for dropzone onDrop callback type conformance
declare function onFileDrop(file: File): Promise<void>;
declare const isLoading: boolean;

const onFilesDropped = async (files: File[]) => onFileDrop(files[0]);



// shape: async arrow in Promise.all().map() delegates to flush() callback returning a Promise; async for map callback type conformance
declare const externalFlushCallbacks: Map<string, () => Promise<void>>;

const flushAllExternals = async () => {
  const flushes = Array.from(externalFlushCallbacks.values());
  await Promise.all(flushes.map(async (flush) => flush()));
};



// shape: Hono async handler delegates to handleOAuthCallbackUrl returning a Promise; async for Hono handler signature conformance
declare function handleOAuthCallbackUrl(opts: { c: unknown; clientOptions: unknown }): Promise<Response>;
declare const OidcClientOptions: unknown;
declare const honoRoute: { get(path: string, handler: (c: unknown) => Promise<Response>): typeof honoRoute };

const callbackRoute = honoRoute
  .get('/oidc', async (c) => handleOAuthCallbackUrl({ c, clientOptions: OidcClientOptions }));



// require-await FP: Hono async handler delegates to service fn returning Promise; async for Hono handler signature conformance
declare const honoApp: { delete: (path: string, handler: (ctx: unknown) => Promise<unknown>) => void };
declare function handleUnsubscribe(ctx: unknown): Promise<Response>;

honoApp.delete('/subscriptions/:id', async (ctx) => handleUnsubscribe(ctx));



// require-await FP: Remix loader async fn returns handler() directly; framework requires async signature, no await needed
declare function rateLimitsHandler(request: Request): Promise<Response>;

export async function loader({ request }: { request: Request }) {
  return rateLimitsHandler(request);
}



// require-await FP: Hono async handler delegates to OAuth callback fn returning Promise; async for Hono handler signature conformance
declare const honoAuth: { get: (path: string, handler: (ctx: unknown) => Promise<unknown>) => void };
declare function processOAuthCallback(ctx: unknown): Promise<Response>;

honoAuth.get('/auth/callback', async (ctx) => processOAuthCallback(ctx));



// require-await FP: Hono async middleware arrow delegates to tRPC server handler returning Promise; async for middleware signature conformance
declare const honoRouter: { use: (path: string, handler: (ctx: unknown, next: () => Promise<void>) => Promise<void>) => void };
declare function trpcServerHandler(ctx: unknown, next: () => Promise<void>): Promise<void>;

honoRouter.use('/api/trpc/*', async (ctx, next) => trpcServerHandler(ctx, next));



// require-await FP: Hono async handler delegates to subscribeHandler returning Promise; async for Hono handler signature conformance
declare const honoApp2: { post: (path: string, handler: (ctx: unknown) => Promise<unknown>) => void };
declare function handleWebhookSubscribe(ctx: unknown): Promise<Response>;

honoApp2.post('/webhooks/subscribe', async (ctx) => handleWebhookSubscribe(ctx));



// require-await FP: triggerJob async arrow delegates to step.sendEvent returning Promise; async for interface method signature conformance
declare const jobStep: { sendEvent: (eventName: string, payload: unknown) => Promise<void> };

const jobClient = {
  triggerJob: async (eventName: string, payload: unknown) => jobStep.sendEvent(eventName, payload),
};



// require-await FP: Hono async handler delegates to testCredentials returning Promise; async for Hono handler signature conformance
declare const honoApp3: { post: (path: string, handler: (ctx: unknown) => Promise<unknown>) => void };
declare function validateCredentials(ctx: unknown): Promise<Response>;

honoApp3.post('/credentials/test', async (ctx) => validateCredentials(ctx));



// require-await FP: createContext async arrow calls createTrpcContext returning Promise; async for tRPC context factory type conformance
declare function buildTrpcContext(req: unknown, res: unknown): Promise<{ userId: string | null }>;

const trpcOptions = {
  createContext: async (req: unknown, res: unknown) => buildTrpcContext(req, res),
};



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// --- require-await shape: framework-handler-conformance (Hono async handler delegates to handler fn) ---
declare function listDocumentsHandler(ctx: unknown): Promise<Response>;
declare const honoApp: { get: (path: string, handler: (ctx: unknown) => Promise<Response>) => void };

honoApp.get('/documents', async (ctx) => listDocumentsHandler(ctx));



// --- require-await shape: framework-handler-conformance (tRPC query async handler delegates) ---
declare function findTeams(input: { userId: string }): Promise<Array<{ id: string; name: string }>>;
declare const publicProcedure: { input: <T>(schema: T) => { query: (handler: (opts: { input: { userId: string } }) => Promise<unknown>) => unknown } };

const teamsRouter = {
  listTeams: publicProcedure
    .input({} as unknown)
    .query(async ({ input }) => findTeams(input as { userId: string })),
};



// --- require-await shape: framework-handler-conformance (Remix clientLoader async empty fn suppresses SSR) ---
export async function clientLoader() {
  return null;
}



// --- require-await shape: framework-handler-conformance (async fn returns handler directly for Hono) ---
declare function createOpenApiHandler(opts: { router: unknown; endpoint: string }): Promise<Response>;
declare const router: unknown;

export async function openApiHandler(ctx: unknown): Promise<Response> {
  return createOpenApiHandler({ router, endpoint: '/api' });
}



// --- require-import shape: CJS module using require() (tailwind config pattern) ---
// eslint-disable-next-line @typescript-eslint/no-require-imports
const brandPlugin = require('./brand-plugin.cjs');

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  plugins: [brandPlugin],
};



// --- require-import shape: CJS module using require() for .cjs plugin file ---
// eslint-disable-next-line @typescript-eslint/no-require-imports
const animationsPlugin = require('@some-lib/animations.cjs');

module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}'],
  plugins: [animationsPlugin],
};



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}



// --- magic-string shape: typed-json-response-discriminant (status field literal) ---
type ApiResponse<T> = { status: 'ok'; data: T } | { status: 'error'; message: string };

declare function jsonResponse<T>(body: ApiResponse<T>, statusCode: number): Response;

export function buildErrorResponse(message: string): Response {
  return jsonResponse({ status: 'error', message }, 400);
}

export function buildSuccessResponse<T>(data: T): Response {
  return jsonResponse({ status: 'ok', data }, 200);
}




// --- magic-string shape: library-api-constant-literal (canvas text wrap mode) ---
declare const KonvaText: new (config: { text: string; wrap: 'word' | 'char' | 'none'; width: number }) => { draw: () => void };

export function createWrappedLabel(text: string, maxWidth: number): { draw: () => void } {
  return new KonvaText({
    text,
    wrap: 'word',
    width: maxWidth,
  });
}




/**
 * tRPC-style fluent query client cache updater pattern.
 * The chained member expression queryClient.users.getById.setData
 * should not trigger argument-type-mismatch when types are correct.
 */

declare const queryClient: {
  users: {
    getById: {
      setData: (input: { id: number }, updater: (old: any) => any) => void;
    };
  };
  posts: {
    list: {
      setData: (input: { authorId: number }, updater: (old: any) => any) => void;
    };
  };
};

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

export function updateUserCache(userId: number, updates: Partial<User>): void {
  queryClient.users.getById.setData(
    { id: userId },
    (oldData) => ({ ...oldData, ...updates })
  );
}

export function updatePostsCache(authorId: number, newPosts: Post[]): void {
  queryClient.posts.list.setData(
    { authorId },
    (oldData) => newPosts
  );
}


// FP: MAP[key] where key is keyof typeof MAP and MAP uses satisfies Record<K, V[]>
// TypeScript guarantees exhaustive coverage but the rule still flags as unchecked-array-access
type WorkspaceRole_ec0dbe1b = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const WORKSPACE_ROLE_PERMISSIONS_MAP_ec0dbe1b = {
  OWNER: ['invite', 'remove', 'billing', 'settings', 'delete'] as string[],
  ADMIN: ['invite', 'remove', 'settings'] as string[],
  MEMBER: ['invite'] as string[],
  VIEWER: [] as string[],
} satisfies Record<WorkspaceRole_ec0dbe1b, string[]>;

const WORKSPACE_ROLE_LABEL_MAP_ec0dbe1b = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
} satisfies Record<WorkspaceRole_ec0dbe1b, string>;

export function getWorkspaceRoleLabel_ec0dbe1b(role: keyof typeof WORKSPACE_ROLE_LABEL_MAP_ec0dbe1b): string {
  return WORKSPACE_ROLE_LABEL_MAP_ec0dbe1b[role];
}

export function workspaceRoleHasPermission_ec0dbe1b(
  role: keyof typeof WORKSPACE_ROLE_PERMISSIONS_MAP_ec0dbe1b,
  permission: string,
): boolean {
  return WORKSPACE_ROLE_PERMISSIONS_MAP_ec0dbe1b[role].includes(permission);
}

