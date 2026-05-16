declare class AppError extends Error { code: string; statusCode?: number; }
declare const genericErrorCodeToStatusMap: Record<string, { status: number } | undefined>;

function getHttpStatusForError(originalError: unknown): number {
  if (originalError instanceof AppError) {
    return originalError.statusCode ?? genericErrorCodeToStatusMap[originalError.code]?.status ?? 400;
  }
  return 500;
}


declare class AppError extends Error { code: string; }
declare const genericErrorCodeToStatusMap: Record<string, { status: number } | undefined>;

function buildResponseMeta(errors: Array<{ cause?: unknown }>) {
  if (errors[0]?.cause instanceof AppError) {
    const appError = errors[0].cause as AppError;
    const httpStatus = genericErrorCodeToStatusMap[appError.code]?.status ?? 400;
    return { status: httpStatus };
  }
  return {};
}
