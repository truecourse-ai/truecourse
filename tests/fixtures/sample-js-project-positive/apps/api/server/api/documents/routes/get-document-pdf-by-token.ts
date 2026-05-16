import { Hono } from 'hono';
const route = new Hono();
route.get('/', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Missing token' }, 400);
  return c.body(new Uint8Array(), 200, { 'Content-Type': 'application/pdf' });
});
export { route };



// instanceof-narrowed-before-access: catch(error) narrowed via instanceof AppError before .code/.message; non-AppError returns fixed string
declare class AppError extends Error {
  code: string;
  message: string;
  constructor(code: string, message: string);
}
declare function generateSignedDownloadUrl(documentId: string, token: string): Promise<string>;

async function handleDocumentDownload(documentId: string, token: string): Promise<{ url: string } | { error: string; status: number }> {
  try {
    const url = await generateSignedDownloadUrl(documentId, token);
    return { url };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message, status: error.code === 'UNAUTHORIZED' ? 401 : 500 };
    }
    return { error: 'Download failed', status: 500 };
  }
}


// Hono route module exports a generic 'route' variable — filename describes the route endpoint, not the export name
import { Hono } from 'hono';

const route = new Hono();

route.get('/preview', async (c) => {
  const token = c.req.query('previewToken');
  if (!token) return c.json({ error: 'Missing preview token' }, 400);

  // Return a placeholder PDF for preview purposes
  const pdfBuffer = new Uint8Array([37, 80, 68, 70]); // %PDF header
  return c.body(pdfBuffer, 200, { 'Content-Type': 'application/pdf' });
});

export { route as previewRoute };



// filename-class-mismatch FP: Hono route module exports a generic 'route' variable as default
// File describes the endpoint (get-document-pdf-by-token), not the export name
declare const HonoRouter: new () => {
  get: (path: string, handler: (c: { json: (b: unknown, s?: number) => unknown; req: { param: (k: string) => string } }) => unknown) => unknown;
};

const tokenPdfRoute = new HonoRouter();

tokenPdfRoute.get('/documents/:token/pdf', (c) => {
  const token = c.req.param('token');
  if (!token) return c.json({ error: 'Not found' }, 404);
  return c.json({ token, contentType: 'application/pdf' });
});

export default tokenPdfRoute;

