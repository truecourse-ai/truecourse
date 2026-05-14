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
