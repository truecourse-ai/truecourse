import { authMiddleware } from './middleware/auth';
import { logger } from '@sample/shared-utils';
export function startApp(): void {
  logger.info(`Auth: ${typeof authMiddleware}`);
}
process.on('uncaughtException', (err: Error) => {
  console.error(err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error(String(reason));
  process.exit(1);
});



// Shared tRPC context + open-api handler — imports from @sample/trpc which is a
// shared library package, not a bounded service with protected internals.
declare const API_V1_URL: string;
declare const API_V1_BETA_URL: string;
declare function createTrpcContext(opts: { req: unknown; requestSource: string }): Promise<unknown>;
declare const appRouter: unknown;
declare function createOpenApiFetchHandler<T>(opts: {
  endpoint: string;
  router: T;
  createContext: () => Promise<unknown>;
  req: unknown;
  onError: (opts: unknown) => void;
  responseMeta: (opts: { errors: Array<{ cause?: unknown }> }) => object;
}): Promise<Response>;
declare function handleTrpcRouterError(opts: unknown, source: string): void;
declare class AppError {
  code: string;
  static parseError(cause: unknown): AppError;
}
declare const genericErrorCodeToTrpcErrorCodeMap: Record<string, { status: number } | undefined>;

type OpenApiHandlerOptions = {
  isBeta: boolean;
};

export const openApiHandler = async (req: Request, { isBeta }: OpenApiHandlerOptions): Promise<Response> => {
  return createOpenApiFetchHandler<typeof appRouter>({
    endpoint: isBeta ? API_V1_BETA_URL : API_V1_URL,
    router: appRouter,
    createContext: async () => createTrpcContext({ req, requestSource: 'apiV1' }),
    req,
    onError: (opts) => handleTrpcRouterError(opts, 'apiV1'),
    responseMeta: (opts) => {
      if (opts.errors[0]?.cause instanceof AppError) {
        const appError = AppError.parseError(opts.errors[0].cause);
        const httpStatus = genericErrorCodeToTrpcErrorCodeMap[appError.code]?.status ?? 400;
        return { status: httpStatus };
      }
      return {};
    },
  });
};



// --- route-without-auth-middleware shape: middleware-call-misidentified-as-route ---
// app.use() with glob pattern fires the rule, but this is CORS middleware, not a route
declare function createApp(): { use: (path: string, ...mw: unknown[]) => void; route: (path: string, r: unknown) => void };
declare const cors: () => unknown;
declare const authenticateMiddleware: unknown;
declare const v1ApiRouter: unknown;
declare const v2ApiRouter: unknown;

const gatewayApp = createApp();

// CORS middleware — app.use(glob, middleware) mistakenly flagged as 'route without auth'
gatewayApp.use('/api/v1/*', cors());
gatewayApp.use('/api/v2/*', cors());

// Actual routes — routers handle auth internally
gatewayApp.use('/api/v1/*', authenticateMiddleware);
gatewayApp.route('/api/v1', v1ApiRouter);
gatewayApp.route('/api/v2', v2ApiRouter);




// --- route-without-auth-middleware shape: auth-inside-framework-dispatcher (tRPC open-api handler with internal procedure auth) ---
declare const trpcServerHandler8042: unknown;
declare function createHonoApp6(): { use: (path: string, ...handlers: unknown[]) => void; get: (path: string, ...handlers: unknown[]) => void };

const apiApp8042 = createHonoApp6();
// The tRPC open-api handler enforces auth inside the procedure chain (authenticatedMiddleware)
// The rule should not flag this as 'route without auth' because auth is inside the dispatcher
apiApp8042.use('/api/v2/*', trpcServerHandler8042);
apiApp8042.use('/api/v2-beta/*', trpcServerHandler8042);



// H19: job runner task with async callback — standard job task pattern, no type mismatch
declare const React: { createElement: (type: string, props?: Record<string, unknown>, ...children: unknown[]) => unknown };
declare const io: { runTask(name: string, handler: () => Promise<unknown>): Promise<unknown> };
declare function renderEmail(component: unknown): string;

async function sendWelcomeEmail(userId: string, userName: string) {
  await io.runTask('render-welcome-email', async () =>
    renderEmail(
      React.createElement('WelcomeEmail', { userId, userName }),
    ),
  );
}



// H42: array.map(async item => {...}) — standard async array map, no type mismatch
interface QueuedTask { id: string; type: string; payload: Record<string, unknown>; retryCount: number; }

declare const queue: {
  getEligibleTasks(limit: number): Promise<QueuedTask[]>;
  processTask(task: QueuedTask): Promise<void>;
  markComplete(taskId: string): Promise<void>;
  markFailed(taskId: string, error: Error): Promise<void>;
};

async function drainQueue(batchSize: number) {
  const eligibleTasks = await queue.getEligibleTasks(batchSize);

  await Promise.allSettled(
    eligibleTasks.map(async (task) => {
      try {
        await queue.processTask(task);
        await queue.markComplete(task.id);
      } catch (err) {
        await queue.markFailed(task.id, err instanceof Error ? err : new Error(String(err)));
      }
    }),
  );
}



// FP shape: app.mount('/', async (request) => handler({...})) — standard framework mount
declare const honoApp: { mount: (path: string, handler: (request: Request) => Promise<Response>) => void };
declare function fetchHandler(opts: { request: Request; endpoint: string }): Promise<Response>;
const API_ENDPOINT = '/api/v1';

honoApp.mount('/', async (request) =>
  fetchHandler({ request, endpoint: API_ENDPOINT }),
);



// FP: initTRPC.meta<RouteMeta>().context<AppContext>().create({...}) — tRPC init chain with generic types
interface RouteMeta { requiresAuth?: boolean; rateLimit?: number; }
interface AppContext { userId: string | null; organizationId: string | null; }
declare const initTRPC: {
  meta: <M>() => {
    context: <C>() => {
      create: (opts: { transformer?: unknown; errorFormatter?: unknown }) => unknown;
    };
  };
};

const t = initTRPC.meta<RouteMeta>().context<AppContext>().create({
  errorFormatter({ shape }) {
    return shape;
  },
});



// FP: baseProcedure.output(ZResponseSchema).query(async ({ctx}) => {...}) — tRPC procedure chain
declare const ZSessionResponseSchema: unknown;
declare const baseProcedure: {
  output: (schema: unknown) => {
    query: (resolver: (opts: { ctx: { userId: string } }) => Promise<unknown>) => unknown;
  };
};

const getSessionProcedure = baseProcedure
  .output(ZSessionResponseSchema)
  .query(async ({ ctx }) => {
    return { userId: ctx.userId, isActive: true };
  });



// FP: db.$kysely.selectFrom(qb...) with chained Kysely query builder — fluent ORM API
declare const db: {
  $kysely: {
    selectFrom: (table: string) => {
      select: (columns: string[]) => {
        where: (col: string, op: string, val: unknown) => {
          execute: () => Promise<unknown[]>;
        };
      };
    };
  };
};

async function getUserStats(orgId: string) {
  return db.$kysely
    .selectFrom('users')
    .select(['id', 'email', 'created_at'])
    .where('organization_id', '=', orgId)
    .execute();
}



// FP: Kysely .where() with expression builder callback (eb) => eb.ref(...) — correct Kysely API
declare const db: {
  $kysely: {
    selectFrom: (table: string) => {
      select: (cols: string[]) => {
        where: (col: string, op: string, val: (eb: { ref: (col: string) => unknown }) => unknown) => {
          execute: () => Promise<unknown[]>;
        };
      };
    };
  };
};

async function getCorrelatedStats(parentId: string) {
  return db.$kysely
    .selectFrom('events')
    .select(['id', 'type', 'created_at'])
    .where('parent_id', '=', (eb) => eb.ref('events.id'))
    .execute();
}



// FP: Promise.all([queryA, queryB, queryC]) — awaiting array of typed query results
declare function fetchUserCount(orgId: string): Promise<number>;
declare function fetchTeamCount(orgId: string): Promise<number>;
declare function fetchActivityStats(orgId: string): Promise<{ total: number; lastWeek: number }>;

async function getOrganizationSummary(orgId: string) {
  const [userCount, teamCount, activityStats] = await Promise.all([
    fetchUserCount(orgId),
    fetchTeamCount(orgId),
    fetchActivityStats(orgId),
  ]);
  return { userCount, teamCount, activityStats };
}



// FP: Promise.all(items.map(async (item) => {...})) — standard async map with correctly typed item
interface DetectedRegion { id: string; boundingBox: { x: number; y: number; width: number; height: number }; }
declare function analyzeRegion(region: DetectedRegion): Promise<{ label: string; confidence: number }>;
declare const detectedRegions: DetectedRegion[];

async function processAllRegions() {
  return Promise.all(
    detectedRegions.map(async (region) => {
      const result = await analyzeRegion(region);
      return { regionId: region.id, ...result };
    }),
  );
}



// FP: db.$transaction(async (tx) => {...}) — async transaction callback is correct Prisma API usage
declare const db: {
  $transaction: <T>(callback: (tx: typeof db) => Promise<T>) => Promise<T>;
  account: { update: (args: { where: { id: string }; data: unknown }) => Promise<unknown> };
  auditLog: { create: (args: { data: unknown }) => Promise<unknown> };
};

async function linkAccounts(primaryId: string, secondaryId: string) {
  return db.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: secondaryId },
      data: { linkedAccountId: primaryId },
    });
    await tx.auditLog.create({
      data: { action: 'account_linked', targetId: secondaryId, sourceId: primaryId },
    });
  });
}



// FP: Array.map() extracting typed properties — standard transform
declare const billingResponse: {
  data: Array<{ id: string; status: string; amount: number; pdfUrl: string | null }>;
};

const invoiceSummaries = billingResponse.data.map((invoice) => ({
  id: invoice.id,
  status: invoice.status,
  amount: invoice.amount,
  pdfUrl: invoice.pdfUrl,
}));



// FP: procedure.mutation() with async handler — standard tRPC mutation
declare const authenticatedProcedure: {
  input: (schema: unknown) => {
    mutation: (fn: (opts: { input: unknown; ctx: unknown }) => Promise<unknown>) => unknown;
  };
};
declare const ZUpdateProfileSchema: unknown;
declare function updateUserProfile(opts: { userId: string; name: string }): Promise<void>;

const updateProfileRoute = authenticatedProcedure
  .input(ZUpdateProfileSchema)
  .mutation(async ({ input, ctx }: { input: { name: string }; ctx: { userId: string } }) => {
    await updateUserProfile({ userId: ctx.userId, name: input.name });
  });



// FP: async function called with object argument — standard async call
declare function extractFieldsFromDocument(opts: {
  context?: string;
  documentId: string;
  userId: string;
  teamId: string;
  onProgress?: (progress: { processed: number; total: number }) => void;
}): Promise<Array<{ type: string; page: number }>>;

async function runFieldExtraction(documentId: string, userId: string, teamId: string) {
  const fields = await extractFieldsFromDocument({
    documentId,
    userId,
    teamId,
    onProgress: (progress) => {
      console.log(`Processed ${progress.processed}/${progress.total}`);
    },
  });
  return fields;
}



// FP: Object literal with arrayBuffer async method — implements File-like interface correctly
declare function uploadFile(file: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string>;

async function storeBuffer(fileName: string, contentType: string, buffer: Buffer) {
  const fileRef = await uploadFile({
    name: fileName,
    type: contentType,
    arrayBuffer: async () => Promise.resolve(buffer),
  });
  return fileRef;
}



// FP: onError handler calling error handler function — standard error handler
declare function handleRouterError(opts: unknown, source: string): void;
declare const trpcServer: (opts: {
  router: unknown;
  endpoint: string;
  createContext: (req: unknown) => Promise<unknown>;
  onError: (opts: unknown) => void;
}) => unknown;
declare const appRouter: unknown;
declare function createContext(req: unknown): Promise<unknown>;

export const apiTrpcServer = trpcServer({
  router: appRouter,
  endpoint: '/api/trpc',
  createContext: async (req) => createContext(req),
  onError: (opts) => handleRouterError(opts, 'trpc'),
});
