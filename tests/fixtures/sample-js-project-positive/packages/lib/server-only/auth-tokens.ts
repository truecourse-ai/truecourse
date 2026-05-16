
// --- unknown-catch-variable shape: catch(error) instanceof-narrowed; non-AppError wraps in new AppError ---
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string });
}
declare const AppErrorCode: { UNKNOWN_ERROR: string; UNAUTHORIZED: string };
declare function issuePresignToken(opts: { apiToken: string; scope: string }): Promise<{ token: string }>;

async function createPresignToken(apiToken: string, scope: string) {
  try {
    return await issuePresignToken({ apiToken, scope });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Failed to create presign token',
    });
  }
}
