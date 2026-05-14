
declare const sValidator: (target: string, schema: unknown) => unknown;
declare const ZFileUploadRequestSchema: unknown;
declare const MAX_UPLOAD_SIZE_MB: number;
declare function storeFile(file: File): Promise<{ fileId: string; url: string }>;

import { Hono } from 'hono';

type ApiEnv = { Variables: { userId: string } };

const fileUploadRoute = new Hono<ApiEnv>()
  .post('/upload', sValidator('form', ZFileUploadRequestSchema), async (c) => {
    try {
      const body = (c as unknown as { req: { valid: (t: string) => { file: File } } }).req.valid('form');
      const { file } = body;

      if (!file) {
        return (c as unknown as { json: (b: unknown, s: number) => unknown }).json({ error: 'No file provided' }, 400);
      }

      const maxBytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        return (c as unknown as { json: (b: unknown, s: number) => unknown }).json({ error: 'File too large' }, 400);
      }

      const result = await storeFile(file);
      return (c as unknown as { json: (b: unknown) => unknown }).json(result);
    } catch (error) {
      return (c as unknown as { json: (b: unknown, s: number) => unknown }).json({ error: 'Upload failed' }, 500);
    }
  });



declare function storeUploadedFile(fileBuffer: Buffer, mimeType: string): Promise<{ url: string }>;

class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

async function handleFileUpload(fileBuffer: Buffer, mimeType: string): Promise<{ url: string }> {
  try {
    return await storeUploadedFile(fileBuffer, mimeType);
  } catch (err) {
    console.error(err);
    throw new AppError('UPLOAD_FAILED', 'Failed to store the uploaded file');
  }
}


// Hono route builder .post() with sValidator('json', schema) middleware — standard Hono pattern; no type mismatch.
declare const ZCreateReportSchema: unknown;
declare function sValidator30(target: string, schema: unknown): unknown;

import { Hono as Hono30 } from 'hono';

type ApiEnv30 = { Variables: { userId: string } };

const reportRoute30 = new Hono30<ApiEnv30>()
  .post('/reports', sValidator30('json', ZCreateReportSchema), async (c: {
    req: { valid(t: string): { title: string; type: string } };
    get(k: string): string;
    json(data: unknown): unknown;
  }) => {
    const body = c.req.valid('json');
    const userId = c.get('userId');
    return c.json({ reportId: `rep_${userId}_${body.title}`, type: body.type });
  });

