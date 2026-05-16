
// G41: Hono createMiddleware with generic type param — standard middleware; no type mismatch
declare type AppEnv = { Variables: { userId: string } };
declare function createMiddleware<E>(handler: (c: { get: (key: string) => string; set: (k: string, v: string) => void }, next: () => Promise<void>) => Promise<void>): object;

const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.get('Authorization');
  if (!token) {
    return;
  }
  c.set('userId', 'parsed-user-id');
  await next();
});



// FP shape: middleware callback with destructured params; no type mismatch
declare function withAuth(
  handler: (args: unknown, user: unknown, org: unknown, ctx: { metadata: Record<string, string> }) => Promise<unknown>
): unknown;
declare function processRequest(args: unknown, user: unknown, org: unknown, metadata: Record<string, string>): Promise<unknown>;

export const secureEndpoint = withAuth(
  async (args, user, org, { metadata }) => processRequest(args, user, org, metadata)
);



// cf8e76637cad: middleware function with async destructured params — Number() coercion with || default
declare function requireAuth<TArgs extends { query: Record<string, string> }, TUser, TTeam, TCtx>(
  fn: (args: TArgs, user: TUser, team: TTeam) => Promise<unknown>
): unknown;

const getTemplatesRoute = requireAuth(async (args, user, team) => {
  const page = Number(args.query.page) || 1;
  const perPage = Number(args.query.perPage) || 10;
  return { page, perPage, userId: (user as { id: string }).id };
});



// d045b5c7c9b9: middleware with deeply nested destructuring params
declare function requireAuth<TArgs extends { params: Record<string, string>; body: Record<string, unknown> }, TUser, TTeam, TCtx extends { logger: { info(data: unknown): void }; metadata: unknown }>(
  fn: (args: TArgs, user: TUser, team: TTeam, ctx: TCtx) => Promise<unknown>
): unknown;

const addParticipantRoute = requireAuth(async (args, user, team, { logger, metadata }) => {
  const { id: orderId } = args.params;
  const { name, email, role } = args.body as { name: string; email: string; role: string };

  logger.info({ input: { id: orderId } });

  return { orderId, name, email, role, addedBy: (user as { id: string }).id };
});


// Middleware with typed async handler — no type mismatch.
interface RequestContext { logger: Console; requestId: string; }
interface AuthUser { id: string; email: string; }
interface AuthTeam { id: string; slug: string; }

declare function authenticatedMiddleware<T>(
  handler: (
    args: { params: Record<string, string>; body: unknown },
    user: AuthUser,
    team: AuthTeam | null,
    ctx: RequestContext,
  ) => Promise<T>,
): (req: unknown, res: unknown) => Promise<void>;

const listDocuments = authenticatedMiddleware(async (args, user, _team, { logger }) => {
  logger.log(`Listing documents for user ${user.id}`);
  return { documents: [], total: 0 };
});



// --- inconsistent-return shape: Hono middleware mixed return (framework idiom) ---
// `return next()` and `return c.redirect()` are control-flow early-exits;
// the bare `return;` exits after side-effects post-await. Declared return
// type is Promise<void> so no actual value inconsistency exists.
declare type HonoContext = { req: { path: string }; redirect: (path: string) => Response };
declare type NextFn = () => Promise<void>;
declare function resolveRedirect(path: string): string | null;
declare function setSessionCookie(ctx: HonoContext, value: string): void;

export const appRouteMiddleware = async (c: HonoContext, next: NextFn): Promise<void> => {
  const { path } = c.req;

  if (/^\/assets\//.test(path)) {
    return next();
  }

  const redirect = resolveRedirect(path);
  if (redirect) {
    return c.redirect(redirect) as unknown as void;
  }

  await next();

  if (path.startsWith('/t/')) {
    setSessionCookie(c, path.split('/')[2]);
    return;
  }
};



// --- elseif-without-else shape: exhaustive-conditions-implicit-noop ---
// CORS origin resolution: if value is false skip entirely, if function call it.
// Other non-array string values pass through directly — no else needed.
declare type OriginFn = (origin: string | undefined, req: unknown) => Promise<string | boolean>;
declare type StaticOrigin = string | boolean | string[];

async function resolveOriginValue(
  reqOrigin: string | undefined,
  req: unknown,
  value: StaticOrigin | OriginFn,
): Promise<string | boolean | string[] | undefined> {
  if (!value) {
    return undefined;
  } else if (typeof value === 'function') {
    return value(reqOrigin, req);
  }
  return value;
}

export async function buildOriginHeaders(
  req: { headers: { get: (key: string) => string | null } },
  origin: StaticOrigin | OriginFn,
): Promise<Record<string, string> | undefined> {
  const reqOrigin = req.headers.get('Origin') || undefined;
  const resolved = await resolveOriginValue(reqOrigin, req, origin);
  if (!resolved) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  if (Array.isArray(resolved)) {
    if (reqOrigin && resolved.includes(reqOrigin)) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
    }
  } else if (typeof resolved === 'string') {
    headers['Access-Control-Allow-Origin'] = resolved;
  } else if (resolved === true) {
    headers['Access-Control-Allow-Origin'] = reqOrigin || '*';
  }
  return headers;
}




// --- missing-return-type shape: property-setter-accessor (TS forbids return type on setters) ---
class HttpResponseAdapter {
  private _statusCode = 200;
  private _body = '';

  get statusCode() {
    return this._statusCode;
  }

  set statusCode(code: number) {
    this._statusCode = code;
  }

  get body() {
    return this._body;
  }

  set body(value: string) {
    this._body = value;
  }

  toResponse(): Response {
    return new Response(this._body, { status: this._statusCode });
  }
}



// --- unknown-catch-variable shape: catch(err) instanceof AppError; accesses .message; non-AppError fixed string ---
declare class ServiceError extends Error {
  message: string;
  constructor(code: string, opts?: { message?: string });
}
declare function validateBearerToken(authorization: string): Promise<{ userId: string; teamId?: string }>;
declare function runHandler(req: unknown, userId: string, teamId?: string): Promise<Response>;

async function authenticatedMiddleware(
  req: { headers: { authorization?: string } },
  handler: typeof runHandler,
): Promise<Response> {
  try {
    if (!req.headers.authorization) {
      return new Response('Unauthorized', { status: 401 });
    }

    const token = await validateBearerToken(req.headers.authorization);
    return await handler(req, token.userId, token.teamId);
  } catch (err) {
    let message = 'Unauthorized';

    if (err instanceof ServiceError) {
      message = err.message;
    }

    return new Response(JSON.stringify({ message }), { status: 401 });
  }
}



// Constrained subtype preservation: T extends object with required headers, used in param and return
declare function processRequest<TCtx extends { headers: { authorization: string; 'x-request-id': string } }>(
  ctx: TCtx,
  handler: (ctx: TCtx & { userId: string }) => Promise<Response>,
): Promise<Response>;

export function withAuth<T extends { headers: { authorization: string; 'x-request-id': string } }>(
  handler: (args: T & { userId: string }) => Promise<Response>,
) {
  return (args: T) => processRequest(args, handler);
}
