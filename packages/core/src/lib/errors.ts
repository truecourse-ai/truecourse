/**
 * Tagged error type used by core to signal HTTP-style status codes back to
 * the adapter layer (Express). The dashboard server's error middleware
 * inspects `statusCode` to map this to a response. Core itself never imports
 * any framework.
 * User-facing exception summaries omit database details. Operation-specific
 * errors retain their original exception as the cause for diagnostics.
 */
export interface AppError extends Error {
  statusCode?: number;
}

export function createAppError(message: string, statusCode: number): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}

/** An operation's public failure message, with its underlying exception as cause. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

const ERROR_SUMMARY_LIMIT = 2_000;
const bound = (message: string): string => message.length <= ERROR_SUMMARY_LIMIT
  ? message : message.slice(0, ERROR_SUMMARY_LIMIT - 3) + '...';

/** Recognize driver errors structurally, without depending on a database library. */
export function summarizeError(error: unknown): string {
  if (error instanceof UserFacingError) return bound(error.message);
  const visited = new Set<object>();
  let current: unknown = error;
  let queryFailure = false;
  for (let depth = 0; depth < 16 && current && typeof current === 'object'; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    if ('query' in current && typeof current.query === 'string' && 'params' in current && Array.isArray(current.params)) {
      queryFailure = true;
    }
    const code = 'code' in current ? current.code : undefined;
    const message = 'message' in current ? current.message : undefined;
    const driverError = ('severity' in current && typeof current.severity === 'string') ||
      ('routine' in current && typeof current.routine === 'string');
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof message === 'string' && (driverError || queryFailure)) {
      return 'An internal error prevented this operation from completing.';
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  if (queryFailure) return 'An internal error prevented this operation from completing.';
  return bound(error instanceof Error ? error.message : String(error));
}
