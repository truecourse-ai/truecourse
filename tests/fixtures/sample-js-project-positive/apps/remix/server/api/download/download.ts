declare const c: { json: (body: any, status: number) => Response };
declare class AppError extends Error { code: string; }
declare const AppErrorCode: { UNAUTHORIZED: string };

const handleDownloadRequest = async () => {
  try {
    return c.json({ data: 'file-content' }, 200);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === AppErrorCode.UNAUTHORIZED) {
        return c.json({ error: error.message }, 401);
      }
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: 'Internal server error' }, 500);
  }
};


declare const c: { json: (body: Record<string, any>, status: number) => Response };
declare class AppError extends Error { code: string; message: string; }
declare const AppErrorCode: { UNAUTHORIZED: string };

function handleDownloadError(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === AppErrorCode.UNAUTHORIZED) {
      return c.json({ error: error.message }, 401);
    }
    return c.json({ error: error.message }, 400);
  }
  return c.json({ error: 'Internal server error' }, 500);
}
