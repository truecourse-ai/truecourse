
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
