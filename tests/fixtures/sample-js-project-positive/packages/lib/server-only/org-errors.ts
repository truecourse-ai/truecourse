
// AppError with a string error code — non-enum error code passed directly as a literal
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string });
}

function assertTokenNotAlreadyUsed(completed: boolean) {
  if (completed) {
    throw new AppError('ALREADY_USED');
  }
}
