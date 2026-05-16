
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


// --- missing-return-await FP: c.json() in Hono is synchronous — no await needed on early returns ---
// All return c.json(...) calls inside a try block are synchronous Response factories;
// no await is needed or appropriate here.
declare const honoCtx: { json: (data: object, status?: number) => object; req: { param: (k: string) => string | undefined } };
declare function resolveToken(token: string): Promise<{ reportId: string; userId: string } | null>;
declare const reportDb: { report: { findFirst: (opts: object) => Promise<{ id: string; pdfUrl: string } | null> } };

export async function handleReportDownload(): Promise<object> {
  const token = honoCtx.req.param('token');

  try {
    if (!token) {
      return honoCtx.json({ error: 'Missing token' }, 400);
    }

    const session = await resolveToken(token);

    if (!session) {
      return honoCtx.json({ error: 'Invalid token' }, 401);
    }

    const report = await reportDb.report.findFirst({ where: { id: session.reportId } } as object);

    if (!report) {
      return honoCtx.json({ error: 'Report not found' }, 404);
    }

    return honoCtx.json({ url: report.pdfUrl });
  } catch (_err) {
    return honoCtx.json({ error: 'Internal server error' }, 500);
  }
}

