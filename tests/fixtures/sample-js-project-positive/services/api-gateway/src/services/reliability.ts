import { logger } from '@sample/shared-utils';
import { authMiddleware } from '../middleware/auth';
export function catchTyped(): void {
  try { throw new Error('test'); } catch { logger.error('Caught an error'); }
}
export function parseInput(input: string): unknown {
  try { return JSON.parse(input) as unknown; } catch { throw new Error('Invalid JSON'); }
}
export function getAuth(): string { return `auth:${typeof authMiddleware}`; }
const FETCH_TIMEOUT_MS = 5000;
export async function syncReturnInTryCatch(url: string): Promise<Response> {
  try {
    const data = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return Response.json(data);
  } catch {
    return Response.json({ ok: false });
  }
}
export function doubleRaf(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
    });
  });
}
export function mapReturnInTryCatch(items: readonly string[]): string[] {
  try {
    return items.map((item) => item.toUpperCase());
  } catch {
    const empty: string[] = [];
    return empty;
  }
}
export function getFromCache(cache: { open: () => string }): string {
  try { return cache.open(); } catch { return ''; }
}
export function healthCheck(): string {
  try {
    // Check Redis/queue connection status
    return 'healthy';
  } catch {
    return 'unhealthy';
  }
}

// Positive: missing-null-check-after-find — find with optional chaining
export function safeFindAccess(items: ReadonlyArray<{ id: number; name: string }>, targetId: number): string {
  return items.find((i) => i.id === targetId)?.name ?? 'unknown';
}

// Positive: floating-promise — Map.delete is synchronous (not a promise)
export function cleanupMap(cache: Map<string, number>, key: string): void {
  cache.delete(key);
}



// --- deeply-nested-logic shape: streaming NDJSON reader (try/finally + while + for-lines + try/catch + switch) ---
// Nesting is inherent to the streaming idiom
async function* readNdJsonStream<T>(
  response: Response
): AsyncGenerator<T> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          switch (parsed.type) {
            case 'data':
              yield parsed.payload as T;
              break;
            case 'error':
              throw new Error(parsed.message);
            default:
              break;
          }
        } catch (parseErr) {
          console.warn('Malformed NDJSON line:', line, parseErr);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}



// --- raw-error-in-response shape: sanitized-error-response (AppError ternary, no raw error) ---
async function handleAiInference(
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as { prompt: string; model: string };
    const result = await runInference(body.prompt, body.model);
    return Response.json({ result });
  } catch (error) {
    // Only sanitized message in response — raw error never reaches client
    const message = error instanceof AppError ? error.message : 'Failed to run inference';
    return new Response(message, { status: error instanceof AppError ? 422 : 500 });
  }
}

declare function runInference(prompt: string, model: string): Promise<string>;



declare class ApiError extends Error { constructor(message: string, status: number): ApiError; }
declare function parseSchema(text: string): { error: string; status: number };
declare function fetchText(): Promise<string>;

export async function fetchApiData(): Promise<void> {
  const text = await fetchText();
  try {
    const parsed = parseSchema(text);
    throw new ApiError(parsed.error, parsed.status);
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }
    throw new ApiError('Failed to fetch data', 500);
  }
}



declare class AppError extends Error { constructor(code: string, options?: { message: string }): AppError; }
declare const AppErrorCode: { UNKNOWN_ERROR: string };
declare function createEmbedRecord(opts: unknown): Promise<{ id: string }>;

export async function createEmbedDocument(opts: unknown): Promise<{ documentId: string }> {
  try {
    const record = await createEmbedRecord(opts);
    return { documentId: record.id };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Failed to create document',
    });
  }
}



declare function fetchWithSignal(url: string, signal: AbortSignal): Promise<Response>;

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithSignal(url, controller.signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}



declare function deleteOutOfBoundsFields(envelopeId: string): Promise<number>;
declare function createPlaceholderFields(envelopeId: string): Promise<string[]>;
declare function fetchFields(envelopeId: string): Promise<{ id: string }[]>;

export async function replaceEnvelopePdf(
  envelopeId: string,
  newPageCount: number,
): Promise<{ fields?: { id: string }[] }> {
  let didFieldsChange = false;

  const deletedCount = await deleteOutOfBoundsFields(envelopeId);
  if (deletedCount > 0) {
    didFieldsChange = true;
  }

  const created = await createPlaceholderFields(envelopeId);
  if (created.length > 0) {
    didFieldsChange = true;
  }

  let fields: { id: string }[] | undefined;

  if (didFieldsChange) {
    fields = await fetchFields(envelopeId);
  }

  return { fields };
}
