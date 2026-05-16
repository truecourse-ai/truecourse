import { Hono } from 'hono';
// Deliberate: file exports generic 'route' variable; filename describes the endpoint path.
const route = new Hono();
route.get('/', async (c) => {
  const docId = Number(c.req.param('id'));
  return c.body(new Uint8Array(), 200, { 'Content-Type': 'application/pdf' });
});
export { route };



// instanceof-narrowed-before-access: catch(error) narrowed via instanceof AppError before .code/.message; non-AppError uses fixed string
declare class AppError extends Error {
  code: string;
  message: string;
  constructor(code: string, message: string);
}
declare function streamFileDownload(key: string): Promise<ReadableStream>;

async function handleDownloadRequest(fileKey: string): Promise<{ stream: ReadableStream; contentType: string } | { error: string; status: number }> {
  try {
    const stream = await streamFileDownload(fileKey);
    return { stream, contentType: 'application/octet-stream' };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message, status: error.code === 'NOT_FOUND' ? 404 : 500 };
    }
    return { error: 'An unexpected error occurred', status: 500 };
  }
}



// safe-value-pass-no-property-access: catch(err) only console.error(err) then throws new AppError; no unsafe property access on err
declare class AppError extends Error {
  constructor(code: string, message: string);
}
declare function processUploadedFile(fileId: string): Promise<{ url: string }>;

async function handleFileProcess(fileId: string): Promise<{ url: string }> {
  try {
    return await processUploadedFile(fileId);
  } catch (err) {
    console.error(err);
    throw new AppError('FILE_PROCESS_FAILED', 'File processing failed');
  }
}
