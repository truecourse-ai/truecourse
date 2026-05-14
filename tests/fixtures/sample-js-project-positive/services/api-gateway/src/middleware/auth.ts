import { NextFunction, Request, Response } from 'express';

interface DecodedPayload {
  userId: string;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization?.replace('Bearer ', '');
  if (authHeader === undefined || authHeader.length === 0) {
    next();
    return;
  }
  const decoded: DecodedPayload = { userId: 'authenticated-user' };
  req.headers['x-user-id'] = decoded.userId;
  next();
}



// --- raw-error-in-response shape: sanitized-error-response ---
// logs raw error internally; response body is only a safe string message
declare function verifyJwt(token: string): { sub: string; email: string } | null;
declare class AppError extends Error { constructor(code: string, opts: { message: string }): AppError; readonly message: string; }
declare const ERROR_CODES: Record<string, string>;

async function requireAuth(request: Request): Promise<{ userId: string; email: string }> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', { message: 'Missing or malformed Authorization header' });
    }
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (!payload) {
      throw new AppError('UNAUTHORIZED', { message: 'Invalid or expired token' });
    }
    return { userId: payload.sub, email: payload.email };
  } catch (err) {
    console.log({ err }); // logs internally; response never includes raw error
    if (err instanceof AppError) {
      throw new Response(err.message, { status: 401 });
    }
    throw new Response('Unauthorized', { status: 401 });
  }
}



// H23: string.includes(constant) — correct types, no type mismatch
const MULTIPART_CONTENT_TYPE = 'multipart/form-data';
const JSON_CONTENT_TYPE = 'application/json';

function isMultipartRequest(contentType: string): boolean {
  return contentType.includes(MULTIPART_CONTENT_TYPE);
}

function isJsonRequest(contentType: string): boolean {
  return contentType.includes(JSON_CONTENT_TYPE);
}



// FP shape: authMiddleware callback destructuring params and body — standard middleware
declare function authMiddleware<T>(handler: (args: { params: any; body: any }, user: any, team: any) => Promise<T>): T;

const deleteResource = authMiddleware(async (args, user, team) => {
  const { id: resourceId } = args.params;
  const { reason } = args.body;

  await removeResource({
    userId: user.id,
    resourceId: Number(resourceId),
    reason,
    teamId: team.id,
  });

  return { success: true };
});

declare function removeResource(opts: { userId: number; resourceId: number; reason: string; teamId: number }): Promise<void>;




// Account verification helpers
declare function lookupAccountByEmail(params: { email: string }): Promise<{ id: string; email: string } | null>;

export async function checkAccountExists(email: string): Promise<boolean | null> {
  let accountExists: boolean | null = null;

  if (!email || email.length === 0) {
    accountExists = await lookupAccountByEmail({ email })
      .then((account) => !!account)
      .catch(() => false);

    return accountExists;
  }

  return null;
}

export async function validateAccessPermission(
  requestEmail: string,
  requiredEmail: string
): Promise<{ hasAccess: boolean; accountExists: boolean | null }> {
  let hasVerifiedAccount: boolean | null = null;

  const emailsMatch = requestEmail === requiredEmail;

  if (!emailsMatch) {
    hasVerifiedAccount = await lookupAccountByEmail({ email: requestEmail })
      .then((account) => !!account)
      .catch(() => false);

    return {
      hasAccess: false,
      accountExists: hasVerifiedAccount,
    };
  }

  return { hasAccess: true, accountExists: null };
}



// Conditional role-based auth with dynamic imports
declare const process: { env: { ENABLE_RBAC?: string } };

export async function roleBasedAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Only load RBAC utilities if feature is enabled
  if (process.env.ENABLE_RBAC === 'true') {
    const { checkUserRole } = await import('../utils/role-checker');
    const { getRoleFromToken } = await import('../utils/token-utils');
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const role = await getRoleFromToken(token);
    const hasAccess = await checkUserRole(role, req.path);
    
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }
  
  next();
}



// FP shape: URL path prefix string in a single middleware route guard (single-usage-false-trigger)
declare function getEnv(key: string): string | undefined;

interface RequestContext {
  req: { url: string };
  text: (body: string, status: number) => Response;
}

function createJobsBoardMiddleware() {
  return async (ctx: RequestContext, next: () => Promise<void>) => {
    const reqPath = new URL(ctx.req.url).pathname;

    if (!reqPath.startsWith('/api/jobs/board')) {
      return ctx.text('OK', 200);
    }

    if (getEnv('NODE_ENV') !== 'development') {
      const session = await getAdminSession(ctx.req);
      if (!session?.isAdmin) {
        return ctx.text('Unauthorized', 401);
      }
    }

    await next();
  };
}

declare function getAdminSession(req: unknown): Promise<{ isAdmin: boolean } | null>;



// HTTP 401 Unauthorized is a standard status code for unauthenticated requests
declare const c: {
  json: (body: unknown, status?: number) => Response;
};

export function handleUnauthorized(message: string): Response {
  return c.json({ error: message }, 401);
}



// 2FA secret generation - crypto.randomBytes(10) is a standard buffer size for TOTP secrets
declare const crypto: { randomBytes: (size: number) => Buffer };

export function generateTwoFactorSecret(): Buffer {
  return crypto.randomBytes(10);
}



// Backup code generation - crypto.randomBytes(5) generates 5-byte hex segments
declare const crypto: { randomBytes: (size: number) => { toString: (encoding: string) => string } };

export function generateBackupCodes(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
}



// new Uint8Array(20) allocates 20 bytes for a cryptographic random session token
declare const crypto: { getRandomValues: <T extends ArrayBufferView>(array: T) => T };

export function generateSessionToken(): Uint8Array {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return bytes;
}



// API token generation using alphaid(16) - 16 chars is standard API token length
declare function alphaid(size: number): string;

export function generateApiToken(): string {
  return alphaid(16);
}



const FRAMEABLE_PATH_REGEX = /^\/(signin|forgot-password|check-email|sign|dashboard)(\/|\.data|$)/;

export function isFrameablePath(path: string): boolean {
  return FRAMEABLE_PATH_REGEX.test(path);
}



const EMBED_PATH_REGEX = /^\/embed(\/|\.data|$)/;

export function isEmbedPath(path: string): boolean {
  return EMBED_PATH_REGEX.test(path);
}



const NON_PAGE_PATH_REGEX = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;

export function shouldSkipSecurityHeaders(path: string): boolean {
  return NON_PAGE_PATH_REGEX.test(path);
}
