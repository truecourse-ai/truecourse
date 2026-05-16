
// [unknown-catch-variable] catch(error) — instanceof AppError guards code access + toRestAPIError
declare class AppError extends Error { code: string; static toRestAPIError(err: AppError): { status: number; body: object } }
declare function processFileUpload(req: Request): Promise<{ fileId: string; url: string }>;

async function handleFileUpload(req: Request): Promise<Response> {
  try {
    const result = await processFileUpload(req);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === 'FILE_TOO_LARGE') {
        return Response.json({ message: 'File exceeds the maximum allowed size' }, { status: 413 });
      }
      const { status, body } = AppError.toRestAPIError(error);
      return Response.json(body, { status });
    }
    return Response.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
