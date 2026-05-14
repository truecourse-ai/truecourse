
// --- generic-error-message shape: server-500-security-fallback ---
// AppError cases surface specific messages; the unknown-error catch-all
// returns 'Internal server error' to prevent internal detail leakage.
declare class AppError extends Error { code: string; message: string; }
declare const AppErrorCode: { UNAUTHORIZED: string; FORBIDDEN: string };
declare function logError(err: unknown): void;
declare function jsonResponse(body: unknown, status: number): Response;

export async function handleFileDownload(req: Request): Promise<Response> {
  try {
    const fileId = new URL(req.url).searchParams.get('id');
    if (!fileId) throw new AppError();

    return jsonResponse({ url: `/files/${fileId}` }, 200);
  } catch (error) {
    logError(error);

    if (error instanceof AppError) {
      if (error.code === AppErrorCode.UNAUTHORIZED) {
        return jsonResponse({ error: error.message }, 401);
      }
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
