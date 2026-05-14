import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
export function narrowData(data: unknown): { str: string } | null {
  if (typeof data === 'string') return { str: data };
  return null;
}
export function getMiddleware(): { auth: typeof authMiddleware; limit: typeof rateLimiter } {
  return { auth: authMiddleware, limit: rateLimiter };
}



// FP shape: client-only UI hook that imports a get* DOM utility from a constants/ path.
// The rule misfires because the imported symbol name starts with `get*`, making it
// look like an API call, even though the source is a constants/viewer utility.
declare function getCanvasPageCount(container: HTMLElement): number;
declare function generateFieldId(): string;
declare type TViewerEnvelope = { pages: number; scale: number };
declare type TFieldEntry = { id: string; page: number; x: number; y: number };

export function useViewerFields(envelope: TViewerEnvelope): {
  fields: TFieldEntry[];
  addField: (page: number, x: number, y: number) => TFieldEntry;
  removeField: (id: string) => void;
} {
  const totalPages = getCanvasPageCount(document.getElementById('viewer-root') as HTMLElement);

  const fields: TFieldEntry[] = [];

  function addField(page: number, x: number, y: number): TFieldEntry {
    if (page < 1 || page > totalPages) {
      throw new RangeError(`Page ${page} is out of range [1, ${totalPages}]`);
    }
    const entry: TFieldEntry = { id: generateFieldId(), page, x, y };
    fields.push(entry);
    return entry;
  }

  function removeField(id: string): void {
    const idx = fields.findIndex((f) => f.id === id);
    if (idx !== -1) fields.splice(idx, 1);
  }

  return { fields, addField, removeField };
}



// --- raw-error-in-response shape: sanitized-error-response (AppError.message or generic string) ---
declare const logger: { error: (msg: string, ctx: unknown) => void };

async function handleDocumentDownload(
  request: Request,
  documentId: string
): Promise<Response> {
  try {
    const doc = await fetchDocumentById(documentId);
    if (!doc) return new Response('Not Found', { status: 404 });
    const pdfBuffer = await renderDocumentAsPdf(doc);
    return new Response(pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch (error) {
    logger.error('Document download failed', { documentId, error });
    // response body: AppError.message (controlled domain string) OR hardcoded generic string
    // raw error object is NEVER in the response body
    if (error instanceof AppError) {
      return new Response(error.message, { status: error.statusCode ?? 500 });
    }
    return new Response('Internal server error', { status: 500 });
  }
}

declare function fetchDocumentById(id: string): Promise<{ id: string; title: string } | null>;
declare function renderDocumentAsPdf(doc: { id: string; title: string }): Promise<ArrayBuffer>;
declare class AppError extends Error { statusCode?: number; }
