export function getUserRoute(id: string): string {
  return `/users/${id}`;
}
export function listUsersRoute(): string {
  return '/users';
}

// function-return-type-varies: multiple branches returning same constructor (Response.json)
const HTTP_BAD_REQUEST = 400;
export function handleRequest(ok: boolean): Response {
  if (ok) return Response.json({ data: 'success' });
  return Response.json({ error: 'fail' }, { status: HTTP_BAD_REQUEST });
}

// Positive: inconsistent-return — function ending with throw (not missing return)
export function mustFind(items: readonly string[], target: string): string {
  for (const item of items) {
    if (item === target) return item;
  }
  throw new Error('not found');
}

// Positive: misleading-array-reverse — reverse on a local copy (not mutating param)
export function getReversed(items: readonly number[]): number[] {
  return [...items].reverse();
}

// Positive: inconsistent-return — all paths return (if-with-return + switch-with-default)
export function formatValue(value: string | null, mode: string): string {
  if (!value) return 'N/A';
  switch (mode) {
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    default: return value;
  }
}

// Positive: missing-unique-constraint — lookup by primary key (not a uniqueness check)
declare const db: { query: { items: { findFirst: (opts: unknown) => unknown } } };
export function refetchById(itemId: string): unknown {
  return db.query.items.findFirst({ where: { id: itemId } });
}

// Positive: missing-unique-constraint — Drizzle eq() lookup by primary key
declare const drizzleDb: {
  query: { users: { findFirst: (opts: unknown) => unknown } };
  insert: (t: unknown) => { values: (v: unknown) => Promise<void> };
};
declare const users: { id: string; email: string };
declare const eq: (col: unknown, val: unknown) => unknown;
export function getUserById(userId: string): unknown {
  return drizzleDb.query.users.findFirst({ where: eq(users.id, userId) });
}

// Positive: missing-unique-constraint — Drizzle eq() lookup by email (commonly unique field)
export async function findOrCreateByEmail(email: string): Promise<unknown> {
  const found = await drizzleDb.query.users.findFirst({ where: eq(users.email, email) });
  if (!found) await drizzleDb.insert(users).values({ email });
  return found;
}



// --- raw-error-in-response shape: sanitized-error-response (AppError.message or 'Internal Server Error') ---
async function handleWebhookSubscribe(
  request: Request,
  userId: string
): Promise<Response> {
  try {
    const body = await request.json() as { callbackUrl: string; events: string[] };
    const subscription = await createWebhookSubscription(userId, body.callbackUrl, body.events);
    return Response.json({ subscriptionId: subscription.id }, { status: 201 });
  } catch (err) {
    console.error('Webhook subscribe error:', err);
    // AppError: returns controlled domain message (not raw error)
    // Other errors: returns hardcoded 'Internal Server Error' string
    if (err instanceof AppError) {
      return new Response(err.message, { status: 400 });
    }
    return new Response('Internal Server Error', { status: 500 });
  }
}

declare function createWebhookSubscription(
  userId: string,
  callbackUrl: string,
  events: string[]
): Promise<{ id: string }>;



// --- route-without-auth-middleware shape: token-in-path-auth-pattern ---
// No session middleware — URL-embedded token IS the authorization mechanism
declare function validateShareToken(token: string, resourceId: string): Promise<{ valid: boolean; permissions: string[] } | null>;
declare function streamResourceFile(resourceId: string): Promise<ReadableStream>;

async function handlePublicResourceDownload(
  request: Request,
  resourceId: string,
  shareToken: string
): Promise<Response> {
  // Token in URL/path is validated against DB — this IS the auth check
  const validation = await validateShareToken(shareToken, resourceId);
  if (!validation || !validation.valid) {
    return new Response(null, { status: 404 }); // 404 not 401 to avoid enumeration
  }
  const stream = await streamResourceFile(resourceId);
  return new Response(stream, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}



// --- route-without-auth-middleware shape: inline-auth-check-in-handler ---
// No dedicated auth middleware, but handler performs inline auth (getOptionalSession + userId check)
declare function getOptionalSession(request: Request): Promise<{ userId: string } | null>;
declare function verifyPresignToken(token: string, resourceId: string): boolean;
declare function checkFileAccess(userId: string, fileId: string): Promise<boolean>;

async function handleFileDownload(
  request: Request,
  fileId: string
): Promise<Response> {
  const url = new URL(request.url);
  const presignToken = url.searchParams.get('presign');

  // Inline auth: presign token path
  if (presignToken) {
    if (!verifyPresignToken(presignToken, fileId)) {
      return new Response(null, { status: 403 });
    }
  } else {
    // Inline auth: session-based path
    const session = await getOptionalSession(request);
    if (!session?.userId) {
      return new Response(null, { status: 404 }); // not 401 to prevent enumeration
    }
    const hasAccess = await checkFileAccess(session.userId, fileId);
    if (!hasAccess) {
      return new Response(null, { status: 403 });
    }
  }

  const fileBuffer = await fetchFileById(fileId);
  return new Response(fileBuffer, { headers: { 'Content-Type': 'application/octet-stream' } });
}

declare function fetchFileById(fileId: string): Promise<ArrayBuffer>;



// Positive: argument-type-mismatch — Hono-style chained route with validator middleware
// bodyValidator returns a middleware; passing it as the second arg to .post() is valid.
declare const bodyValidator: (format: string, schema: unknown) => unknown;
declare const UserCreateSchema: unknown;
declare const UserSearchSchema: unknown;
declare class ApiApp<T> {
  post(path: string, ...handlers: unknown[]): this;
  get(path: string, ...handlers: unknown[]): this;
}
interface AppContext { userId: string; }
declare const createUser: (data: unknown) => Promise<unknown>;
declare const searchUsers: (query: unknown) => Promise<unknown[]>;

export const userRoutes = new ApiApp<AppContext>()
  .post('/users', bodyValidator('json', UserCreateSchema), async (ctx: AppContext) => {
    const result = await createUser({ ctx });
    return result;
  })
  .get('/users/search', bodyValidator('json', UserSearchSchema), async (ctx: AppContext) => {
    const results = await searchUsers({ ctx });
    return results;
  });



// FP shape: default sort-by string in a single route loader (single-usage-false-trigger)
declare function parseUrl(url: string): { searchParams: { get: (key: string) => string | null } };

type SortByField = 'name' | 'createdAt' | 'signingVolume';
type SortOrder = 'asc' | 'desc';

async function organisationInsightsLoader(request: { url: string }) {
  const url = parseUrl(request.url);

  const rawSortBy = url.searchParams.get('sortBy') || 'signingVolume';
  const rawSortOrder = url.searchParams.get('sortOrder') || 'desc';

  const isSortBy = (v: string): v is SortByField =>
    v === 'name' || v === 'createdAt' || v === 'signingVolume';

  const sortBy: SortByField = isSortBy(rawSortBy) ? rawSortBy : 'signingVolume';

  return { sortBy, sortOrder: rawSortOrder };
}



// Positive: magic-number — HTTP 201 Created passed directly to c.text() is a standard status code, not a magic number
declare const c: { text: (body: string, status: number) => Response; req: { valid: (type: string) => { userId: string } } };
declare function deactivateUserSession(userId: string): Promise<void>;
export async function handleSessionRevoke(): Promise<Response> {
  const { userId } = c.req.valid('json');
  await deactivateUserSession(userId);
  return c.text('OK', 201);
}



// Positive (FP): magic-number — 200 is a standard HTTP OK status code passed to c.status()
declare const ctx: { status: (code: number) => void; get: (key: string) => unknown };
declare function clearAuthCookie(c: typeof ctx): void;
declare function revokeToken(token: string): Promise<void>;
export async function handleLogout(token: string): Promise<void> {
  await revokeToken(token);
  clearAuthCookie(ctx);
  ctx.status(200);
}



// Positive: magic-number — HTTP 200 in c.text() is a standard OK status code, not a magic number
type RouteContext = { text: (body: string, status?: number) => Response; req: { url: string } };

export async function jobsBoardRouteHandler(c: RouteContext): Promise<Response> {
  const reqPath = new URL(c.req.url).pathname;
  if (!reqPath.startsWith('/api/jobs/board')) {
    return c.text('OK', 200);
  }
  return c.text('Unauthorized', 401);
}



// Positive: magic-number — raw HTTP 500 literal passed directly to c.text() (Hono-style context)
declare const c: {
  text: (body: string, status?: number) => Response;
  json: (body: unknown, status?: number) => Response;
};
export function handleTaskRetryExceeded(retriesUsed: number, maxRetries: number): Response {
  if (retriesUsed >= maxRetries) {
    return c.text('Task exceeded maximum retries', 500);
  }
  return c.json({ status: 'retrying' });
}



// Positive: magic-number FP — HTTP 500 literal in ApiError constructor is a standard status code
declare class GatewayApiError extends Error {
  constructor(message: string, statusCode: number);
}
export async function processStreamingResponse(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new GatewayApiError('No response body available', 500);
  }

  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let done = false;

  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (!done && result.value) {
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
  }

  return chunks;
}



// Positive: magic-number — HTTP status codes (401, 404) in c.json() are well-known protocol constants, not opaque magic numbers
declare const c: {
  json: (body: unknown, status?: number) => Response;
  text: (body: string, status?: number) => Response;
};
declare function fetchDocument(id: string): { id: string; title: string; data: string } | null;
declare function resolveSession(token: string | undefined): { userId: string; role: string } | null;

export function handleDocumentFetch(id: string, authToken: string | undefined): Response {
  const session = resolveSession(authToken);
  if (!session) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const doc = fetchDocument(id);
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404);
  }
  return c.json({ data: doc });
}

export function handleDocumentDelete(id: string, authToken: string | undefined): Response {
  const session = resolveSession(authToken);
  if (!session) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const doc = fetchDocument(id);
  if (!doc) {
    return c.json({ error: 'Document not found' }, 404);
  }
  return c.json({ success: true });
}



// Positive: magic-number — c.status(200) is a standard HTTP OK status code, not a magic number
declare const ctx: { status: (code: number) => Response; json: (body: unknown, init?: { status?: number }) => Response };
declare function revokeUserSession(userId: string, sessionId: string): Promise<void>;
declare function deleteAuthCookie(c: typeof ctx): void;
declare function getSessionCookie(c: typeof ctx): string | null;
declare function validateSession(token: string): Promise<{ session: { id: string; userId: string } | null }>;

export async function signOutHandler(c: typeof ctx, userId: string, sessionId: string): Promise<Response> {
  const token = getSessionCookie(c);
  if (!token) {
    return c.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { session } = await validateSession(token);
  if (!session) {
    deleteAuthCookie(c);
    return c.json({ error: 'Session not found' }, { status: 401 });
  }

  await revokeUserSession(session.userId, sessionId);

  if (session.id === sessionId) {
    deleteAuthCookie(c);
  }

  return c.status(200);
}



// Pagination defaults for user listing endpoint
declare function getUserSearchParams(req: { url: string }): URLSearchParams;
declare function findUsers(opts: { query: string; page: number; limit: number }): Promise<{ users: unknown[]; totalPages: number }>;

export async function listUsersHandler(req: { url: string }) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page')) || 1;
  const limit = Number(url.searchParams.get('limit')) || 10;
  const query = url.searchParams.get('query') || '';

  const { users, totalPages } = await findUsers({ query, page, limit });

  return { users, totalPages, page, limit };
}



// HTTP 500 Internal Server Error for upload failures - standard status code
declare const c: { json: (body: unknown, status?: number) => Response };

export async function handleFileUploadError(message: string): Promise<Response> {
  return c.json({ success: false, error: message }, 500);
}



// HTTP 500 for AI detection errors - standard Internal Server Error status code
declare const c: { json: (body: unknown, status?: number) => Response };

export async function handleAiDetectionError(err: Error): Promise<Response> {
  return c.json({ success: false, message: err.message }, 500);
}

export async function handleAiProcessingError(): Promise<Response> {
  return c.json({ success: false, message: 'Processing failed' }, 500);
}



// HTTP 201 Created is the standard status code for successful resource creation
declare const c: { text: (body: string, status?: number) => Response };

export async function handleUserRegistration(userId: string): Promise<Response> {
  return c.text(userId, 201);
}



// HTTP 302 Found is the standard redirect status code for OAuth callbacks
declare const c: { redirect: (url: string, status?: number) => Response };

export function redirectToOrganisationSetup(callbackUrl: string): Response {
  return c.redirect(callbackUrl, 302);
}



// HTTP 201 Created for 2FA setup success - standard status code for resource creation
declare const c: { text: (body: string, status?: number) => Response };

export async function handleTwoFactorSetupSuccess(): Promise<Response> {
  return c.text('Two-factor authentication enabled', 201);
}
