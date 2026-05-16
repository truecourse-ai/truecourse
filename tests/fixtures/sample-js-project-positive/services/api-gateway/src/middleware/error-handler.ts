import { logger } from '@sample/shared-utils';
const HTTP_INTERNAL_ERROR = 500;
const HTTP_NOT_FOUND = 404;
export function getStatusCodes(): { internal: number; notFound: number } {
  return { internal: HTTP_INTERNAL_ERROR, notFound: HTTP_NOT_FOUND };
}
export function logError(message: string): void {
  logger.error(message);
}



// --- raw-error-in-response shape: error-rethrown-no-response (logs then re-throws, no HTTP response) ---
// No HTTP response is constructed; error propagates to the framework handler
async function handleOAuthCallback(
  request: Request,
  provider: string
): Promise<void> {
  try {
    const code = new URL(request.url).searchParams.get('code');
    if (!code) throw new Error('Missing OAuth authorization code');
    await exchangeCodeForTokens(provider, code);
  } catch (err) {
    console.error('OAuth callback error:', { provider, err });
    // Re-throws as a controlled AppError or re-throws original
    // Framework handler constructs the response — not this function
    if (err instanceof AppError) throw err;
    throw new AppError('OAUTH_CALLBACK_ERROR', {
      message: (err as Error).message,
    });
  }
}

declare function exchangeCodeForTokens(provider: string, code: string): Promise<{ accessToken: string; refreshToken: string }>;



declare const c: { json: (body: unknown, status?: number) => Response };
declare const AppError: { UNKNOWN: string };

export function handleUnknownError(err: unknown): Response {
  console.error('Unhandled error:', err);
  return c.json(
    {
      code: AppError.UNKNOWN,
      message: 'Internal Server Error',
      statusCode: 500,
    },
    500,
  );
}



// err.statusCode === 500 checks for Internal Server Error — standard HTTP status code
declare class TsRestHttpError { statusCode: number; message: string; }

function apiErrorHandler(err: unknown): void {
  if (err instanceof TsRestHttpError && err.statusCode === 500) {
    console.error(err);
  }
}



// 500 as fallback HTTP status code - standard Internal Server Error default
const errorCodeMap: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

export function getErrorMessage(errorCode?: number): string {
  return errorCodeMap[errorCode || 500] ?? 'Unknown Error';
}



// HTTP 500 check - standard way to identify non-server-error responses
interface AppError { status: number; message: string; }

export function isClientError(error: AppError): boolean {
  return error.status !== 500;
}

export function shouldExposeErrorMessage(error: AppError): boolean {
  return error.status !== 500;
}



// errorCode !== 404 checks for Not Found status; standard HTTP status code comparison
interface RouteError { errorCode?: number; message?: string; }

export function isNotFoundError(error: RouteError): boolean {
  return error.errorCode === 404;
}

export function shouldShowCustomNotFound(error: RouteError): boolean {
  return error.errorCode !== 404;
}



declare function classifyFailure(reason: unknown): string;

export function buildRestErrorResponse(reason: unknown): {
  status: 400 | 401 | 403 | 404 | 500 | 501;
  body: { message: string };
} {
  const tag = classifyFailure(reason);
  if (tag === 'bad-request') return { status: 400, body: { message: 'Bad request' } };
  if (tag === 'unauthorized') return { status: 401, body: { message: 'Unauthorized' } };
  if (tag === 'forbidden') return { status: 403, body: { message: 'Forbidden' } };
  if (tag === 'not-found') return { status: 404, body: { message: 'Not found' } };
  if (tag === 'not-implemented') return { status: 501, body: { message: 'Not implemented' } };
  return { status: 500, body: { message: 'Internal error' } };
}



declare function parseRequestBody(req: unknown): Promise<unknown>;
declare const req: { body: unknown };

export async function extractRequestPayload(): Promise<{ isValid: boolean; data?: unknown; cause?: unknown }> {
  try {
    const body = await parseRequestBody(req);
    return {
      isValid: true,
      data: body,
    };
  } catch (err) {
    return {
      isValid: false,
      cause: err,
    };
  }
}



declare function getComputedFontSize(): string;

export function resolveBaseFontSize(): number {
  try {
    const raw = getComputedFontSize();
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      return 16;
    }
    return parsed;
  } catch (error) {
    return 16;
  }
}



declare function writeToClipboard(value: string): Promise<void>;
declare function fallbackCopy(value: string): Promise<void>;

export async function copyToClipboard(value: string): Promise<void> {
  try {
    await writeToClipboard(value);
  } catch (e) {
    await fallbackCopy(value);
  }
}



declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare const AppErrorCode: { NOT_FOUND: string };
declare function showNotification(opts: { title: string; description: string; variant: string }): void;
declare function moveResource(id: string, targetId: string): Promise<void>;

export async function moveToFolder(resourceId: string, folderId: string): Promise<void> {
  try {
    await moveResource(resourceId, folderId);
    showNotification({ title: 'Resource moved', description: 'Moved successfully.', variant: 'default' });
  } catch (err) {
    const error = AppError.parseError(err);
    if (error.code === AppErrorCode.NOT_FOUND) {
      showNotification({ title: 'Error', description: 'Folder not found.', variant: 'destructive' });
    }
  }
}



declare function showToast(opts: { title: string; variant: string }): void;
declare function deleteAdminRecord(id: string): Promise<void>;
declare function navigateTo(path: string): Promise<void>;

export async function deleteAdminDocument(id: string): Promise<void> {
  try {
    await deleteAdminRecord(id);
    showToast({ title: 'Document deleted', variant: 'default' });
    await navigateTo('/admin/documents');
  } catch (err) {
    showToast({
      title: 'An unknown error occurred',
      variant: 'destructive',
    });
  }
}



declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function registerWebhook(opts: { url: string; events: string[] }): Promise<void>;

export async function createWebhookHandler(url: string, events: string[]): Promise<void> {
  try {
    await registerWebhook({ url, events });
    showToast({ title: 'Webhook created', description: 'The webhook was successfully created.' });
  } catch (err) {
    showToast({
      title: 'Error',
      description: 'An error occurred while creating the webhook. Please try again.',
      variant: 'destructive',
    });
  }
}



declare function saveSettingsData(data: unknown): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;

export async function autoSaveSettings(data: unknown): Promise<void> {
  try {
    await saveSettingsData(data);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Error',
      description: 'An error occurred while auto-saving the settings.',
      variant: 'destructive',
    });
  }
}
