/**
 * Tagged error type used by core to signal HTTP-style status codes back to
 * the adapter layer (Express). The dashboard server's error middleware
 * inspects `statusCode` to map this to a response. Core itself never imports
 * any framework.
 */
export interface AppError extends Error {
  statusCode?: number;
}

export function createAppError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}
