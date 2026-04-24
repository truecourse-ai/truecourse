/**
 * Tagged error type used by core to signal HTTP-style status codes back to
 * adapter layers (Express, CLI). The dashboard server's error middleware
 * inspects `statusCode` to map this to a response. The CLI surfaces the
 * message directly. Core itself never imports any framework.
 */
export interface AppError extends Error {
  statusCode?: number;
}

export function createAppError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}
