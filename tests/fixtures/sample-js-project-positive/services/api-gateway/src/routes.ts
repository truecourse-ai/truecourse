
// Wave-M05: middleware callback destructuring args.params and args.body — typed by middleware contract
declare function requestMiddleware(
  handler: (args: { params: { id: string; itemId: string }; body: { recipientId: number; type: string; pageNumber: number } }) => Promise<{ status: number; body: unknown }>
): unknown;

const updateItemRoute = requestMiddleware(async (args) => {
  const { id: documentId, itemId } = args.params;
  const { recipientId, type, pageNumber } = args.body;

  return {
    status: 200,
    body: { documentId, itemId, recipientId, type, pageNumber },
  };
});



// Wave-M16: Number(queryParam) || defaultValue — standard coercion with fallback
declare const query: { page?: string; perPage?: string; limit?: string };

function getPaginationParams(query: { page?: string; perPage?: string }) {
  const page = Number(query.page) || 1;
  const perPage = Number(query.perPage) || 10;
  return { page, perPage };
}



// Wave-M18: middleware callback destructuring args.params and args.query — typed by middleware
declare function requestMiddleware(
  handler: (args: { params: { id: string }; query: { page?: string; perPage?: string } }) => Promise<{ status: number; body: unknown }>
): unknown;

const listItemsRoute = requestMiddleware(async (args) => {
  const { id: documentId } = args.params;
  const { page, perPage } = args.query;
  const pageNum = Number(page) || 1;
  const perPageNum = Number(perPage) || 10;
  return {
    status: 200,
    body: { documentId, page: pageNum, perPage: perPageNum },
  };
});



// Wave-M30: setRecipients call with discriminated union id object — 'documentId' literal is valid
declare function setRecipients(opts: {
  id: { type: 'documentId'; id: number } | { type: 'templateId'; id: number };
  userId: number;
  teamId: number;
  recipients: Array<{ email: string; name: string; role: string }>;
}): Promise<{ recipients: Array<{ id: number; email: string }> }>;

declare const documentId: string;
declare const userId: number;
declare const teamId: number;

const { recipients: updatedRecipients } = await setRecipients({
  id: { type: 'documentId', id: Number(documentId) },
  userId,
  teamId,
  recipients: [{ email: 'user@example.com', name: 'User', role: 'SIGNER' }],
});



// Snippet: Hono-style route handler with async context callback — types correct
declare const app: { get: (path: string, handler: (c: unknown) => Promise<unknown>) => unknown };
declare function handleOAuthCallback(opts: { c: unknown; provider: string }): Promise<unknown>;

app.get('/auth/callback', async (c) => handleOAuthCallback({ c, provider: 'github' }));



// FP shape: router .all() handler with async function — standard HTTP framework routing
declare const router: {
  all: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => typeof router;
  get: (path: string, handler: (c: { req: { raw: Request } }) => Promise<Response>) => typeof router;
};
declare function handleListItems(req: Request): Promise<Response>;
declare function handleCreateItem(req: Request): Promise<Response>;

router
  .all('/api/items/list', async (c) => handleListItems(c.req.raw))
  .all('/api/items/create', async (c) => handleCreateItem(c.req.raw));



// FP shape: Hono .get() with validator middleware — standard Hono route definition
declare const apiRouter: {
  get: (path: string, validator: unknown, handler: (c: { req: { valid: (type: string) => unknown; header: (name: string) => string | undefined } }) => Promise<Response>) => typeof apiRouter;
};
declare function sValidator(type: string, schema: unknown): unknown;
declare const ZDownloadParamsSchema: unknown;

apiRouter.get(
  '/files/:fileId/download',
  sValidator('param', ZDownloadParamsSchema),
  async (c) => {
    const { fileId } = c.req.valid('param') as { fileId: string };
    const authHeader = c.req.header('authorization');
    return new Response(`Downloading ${fileId} with auth ${authHeader}`);
  }
);



// FP shape: Hono app.use() middleware accessing c.get('key') — standard Hono middleware
declare const app: {
  use: (path: string, handler: (c: { get: (key: string) => unknown; next: () => Promise<void> }) => Promise<void>) => void;
};

app.use('/api/*', async (c) => {
  const requestContext = c.get('context');
  if (!requestContext) {
    throw new Error('Missing request context');
  }
  await c.next();
});



// FP shape: middleware callback receiving (args, user, team) with query param coercion
declare function withAuth<T>(handler: (args: { query: Record<string, string> }, user: { id: number }, team: { id: number }) => Promise<T>): T;
declare function listItems(opts: { page: number; perPage: number; userId: number; teamId: number }): Promise<{ data: unknown[]; totalPages: number }>;

const getItemsRoute = withAuth(async (args, user, team) => {
  const page = Number(args.query.page) || 1;
  const perPage = Number(args.query.perPage) || 20;

  const { data, totalPages } = await listItems({
    page,
    perPage,
    userId: user.id,
    teamId: team.id,
  });

  return { status: 200, body: { data, totalPages } };
});



// FP shape: Hono .all() handler passing c.req.raw (Request) to a typed handler
declare function handleWebhookRequest(request: Request): Promise<Response>;
declare function handleListEndpoint(request: Request): Promise<Response>;
declare const app: { all: (path: string, fn: (c: { req: { raw: Request } }) => Promise<Response>) => void };

app.all('/webhooks/receive', async (c) => handleWebhookRequest(c.req.raw));
app.all('/api/list', async (c) => handleListEndpoint(c.req.raw));



// FP shape: Number() coercion of query string params with numeric fallback
declare function withAuth<T>(handler: (args: { query: Record<string, string | undefined> }) => Promise<T>): T;
declare function paginatedSearch(opts: { page: number; limit: number; query: string }): Promise<unknown[]>;

const searchRoute = withAuth(async (args) => {
  const page = Number(args.query.page) || 1;
  const limit = Number(args.query.limit) || 25;
  const query = args.query.q || '';

  const results = await paginatedSearch({ page, limit, query });
  return { status: 200, body: { results } };
});



// --- function-return-type-varies shape: discriminated union loader (Remix/RR7 pattern) ---
// Both branches use `as const` to produce discriminated literal types.
// The component narrows on `data.state` — varying shapes are by design.
declare function fetchInviteRecord(token: string): Promise<{ organisationName: string } | null>;

export async function loadInviteDeclinePage(params: { token?: string }) {
  const { token } = params;

  if (!token) {
    return { state: 'InvalidLink' } as const;
  }

  const invite = await fetchInviteRecord(token);

  if (!invite) {
    return { state: 'InvalidLink' } as const;
  }

  return {
    state: 'Success',
    organisationName: invite.organisationName,
  } as const;
}



// --- function-return-type-varies shape: framework meta() returning undefined vs tag array ---
// React Router v7 meta() may return undefined to suppress meta tags for
// certain routes; returning undefined vs. MetaDescriptor[] is idiomatic.
declare type MetaDescriptor = { title?: string; name?: string; content?: string };
declare type MetaArgs = { data: unknown };

export function qrPageMeta({ data }: MetaArgs): MetaDescriptor[] | undefined {
  if (!data) {
    return undefined;
  }

  return [
    { title: 'Scan QR Code' },
    { name: 'robots', content: 'noindex' },
  ];
}



// File upload size validation - returns 400 for files exceeding limit
declare const c: any;
declare const MAX_FILE_SIZE_MB: number;

async function handleFileUpload(req: any) {
  const file = req.file;
  if (!file || file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return c.json({ error: 'File too large' }, 400);
  }
  return c.json({ success: true });
}



// OAuth callback handler - 302 Found redirect to complete auth flow
declare const c: any;

async function handleOAuthCallback(callbackUrl: string) {
  if (!callbackUrl) {
    return c.redirect('/auth/error', 302);
  }
  return c.redirect(callbackUrl, 302);
}



// Passkey authentication route - explicit 200 status for WebAuthn response
declare const c: any;

async function handlePasskeyVerification(credential: object) {
  const result = await verifyPasskeyCredential(credential);
  return c.json({ verified: result.verified }, 200);
}

declare function verifyPasskeyCredential(cred: object): Promise<{ verified: boolean }>;



// Job client HTTP handler - 400 for malformed job payload
declare const c: any;

async function handleJobSubmit(body: any) {
  if (!body || !body.type) {
    return c.text('Invalid job payload', 400);
  }
  return c.text('Job accepted', 202);
}



// TRPC error handler - distinguish server errors from client errors
interface AppError { statusCode: number; message: string }

function handleAppError(appError: AppError) {
  if (appError.statusCode === 500) {
    console.error('Internal server error:', appError.message);
    return { userMessage: 'An unexpected error occurred' };
  }
  return { userMessage: appError.message };
}



// Job queue HTTP handler - 401 for missing or invalid auth header
declare const c: any;

async function handleAuthenticatedJobRequest(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.text('Unauthorized', 401);
  }
  return c.text('OK', 200);
}



// AI field detection client - 500 indicates server-side AI processing failure
class AiDetectionError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message);
    this.name = 'AiDetectionError';
  }
}

declare function callAiDetectionService(payload: object): Promise<any>;

async function detectFields(payload: object) {
  const response = await callAiDetectionService(payload);
  if (!response.ok) {
    throw new AiDetectionError('AI detection service failed', 500);
  }
  return response.json();
}



// OAuth callback URL handler - 302 Found redirect after state validation
declare const c: any;
declare function validateOAuthState(state: string): boolean;

async function handleOAuthCallbackWithState(state: string, redirectUrl: string) {
  if (!validateOAuthState(state)) {
    return c.redirect('/auth/error?reason=invalid_state', 302);
  }
  return c.redirect(redirectUrl, 302);
}



// Auth server error handler - fall back to 500 for errors without status code
interface ServerError { statusCode?: number; message: string }

function normalizeErrorResponse(err: ServerError) {
  return {
    statusCode: err.statusCode || 500,
    message: err.message || 'Internal Server Error',
  };
}



// OAuth 2.0 / OIDC configuration - standard scope strings
interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  scope: string[];
}

const googleOAuthConfig: OAuthProviderConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  scope: ['openid', 'email', 'profile'],
};

declare const process: { env: Record<string, string | undefined> };



// --- magic-string FP shape: framework-library-api (Hono route path string) ---
declare const app: {
  post: (path: string, ...handlers: Array<(c: unknown) => unknown>) => void;
  get: (path: string, ...handlers: Array<(c: unknown) => unknown>) => void;
};
declare function validateBody(schema: unknown): (c: unknown) => unknown;
declare function handleAuthorize(c: unknown): unknown;
declare const credentialsSchema: unknown;

app.post('/authorize', validateBody(credentialsSchema), handleAuthorize);
app.get('/authorize', handleAuthorize);



// --- magic-string FP shape: framework-library-api (Hono OAuth route path) ---
declare const oauthRouter: {
  post: (path: string, handler: (c: unknown) => unknown) => void;
  get: (path: string, handler: (c: unknown) => unknown) => void;
};
declare function handleGoogleOAuth(c: unknown): unknown;
declare function handleGitHubOAuth(c: unknown): unknown;

oauthRouter.post('/authorize/google', handleGoogleOAuth);
oauthRouter.post('/authorize/github', handleGitHubOAuth);



// --- magic-string FP shape: framework-library-api (Hono sValidator location identifier) ---
declare function sValidator(location: 'param' | 'json' | 'query' | 'header' | 'form', schema: unknown): (c: unknown) => unknown;
declare const downloadParamSchema: unknown;
declare const downloadQuerySchema: unknown;
declare function handleFileDownload(c: unknown): unknown;
declare const fileRouter: { get: (path: string, ...handlers: Array<(c: unknown) => unknown>) => void };

fileRouter.get('/download/:fileId',
  sValidator('param', downloadParamSchema),
  sValidator('query', downloadQuerySchema),
  handleFileDownload,
);



// --- magic-string FP shape: web-protocol-standard (HTTP standard header name) ---
declare const c: { header: (name: string, value: string) => void; json: (data: unknown) => unknown };
declare function generateEtag(content: string): string;
declare function getFileContent(fileId: string): Promise<string>;

async function serveFileWithCaching(fileId: string) {
  const content = await getFileContent(fileId);
  const etag = generateEtag(content);
  c.header('ETag', etag);
  c.header('Cache-Control', 'max-age=3600');
  return c.json({ content });
}



// --- magic-string FP shape: framework-library-api (Hono two-factor route path) ---
declare const twoFactorRouter: {
  post: (path: string, ...handlers: Array<(c: unknown) => unknown>) => void;
  delete: (path: string, handler: (c: unknown) => unknown) => void;
};
declare function handleEnable(c: unknown): unknown;
declare function handleDisable(c: unknown): unknown;
declare function requireAuth(c: unknown): unknown;

twoFactorRouter.post('/enable', requireAuth, handleEnable);
twoFactorRouter.delete('/disable', requireAuth, handleDisable);
