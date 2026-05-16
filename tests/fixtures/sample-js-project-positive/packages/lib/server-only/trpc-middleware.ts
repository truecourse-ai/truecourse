// FP shape: tRPC t.middleware with async callback destructuring ctx/next/path/meta — no type mismatch
interface TrpcContext { userId: string | null; requestId: string }
interface MiddlewareOpts<Ctx, Meta> {
  ctx: Ctx;
  next: () => Promise<unknown>;
  path: string;
  meta?: Meta;
}
interface RouteMeta { logLevel?: 'debug' | 'info' | 'warn' }
declare const t: {
  middleware: <Ctx, Meta>(fn: (opts: MiddlewareOpts<Ctx, Meta>) => Promise<unknown>) => unknown;
};

const loggingMiddleware = t.middleware(async ({ ctx, next, path, meta }: MiddlewareOpts<TrpcContext, RouteMeta>) => {
  const level = meta?.logLevel ?? 'info';
  console[level](`[${ctx.requestId}] ${path}`);
  return next();
});



// E17: middleware callback with destructured typed args — no type mismatch.
interface RequestContext {
  requestId: string;
  traceId: string;
}

interface AuthUser {
  id: string;
  email: string;
}

interface OrgTeam {
  id: string;
  slug: string;
}

declare function withAuthMiddleware(
  handler: (args: { req: unknown; res: unknown }, user: AuthUser, team: OrgTeam, ctx: { metadata: RequestContext }) => Promise<void>
): void;

withAuthMiddleware(async (args, user, team, { metadata }) => {
  const { requestId } = metadata;
  console.log(`[${requestId}] user=${user.id} team=${team.slug}`);
});



// E30: Lingui translation function called with message descriptor — correct API; no type mismatch.
interface MessageDescriptor {
  id: string;
  message: string;
}

declare function _translate(descriptor: MessageDescriptor): string;
declare const msg: (strings: TemplateStringsArray, ...values: unknown[]) => MessageDescriptor;

const previewText = msg`Sign your contract to get started`;
const translatedPreview = _translate(previewText);



declare const t: { middleware: <T>(fn: (opts: { ctx: T; next: (args: { ctx: T }) => Promise<unknown>; path: string }) => Promise<unknown>) => unknown };
declare function generateRequestId(): string;
declare const logger: { child: (meta: Record<string, unknown>) => { info: (data: Record<string, unknown>) => void } };

const requestMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const requestId = generateRequestId();
  const requestLogger = logger.child({ requestId });

  requestLogger.info({
    path,
    requestId,
    trpcMiddleware: 'request',
  });

  return await next({
    ctx: {
      ...ctx,
      logger: requestLogger,
    },
  });
});
