/**
 * Project-specific error wrapper. `AppError.parseError(err)` walks
 * instanceof/typeof checks internally and returns a discriminated
 * `AppError` instance. Used across the web service in catch blocks.
 */

export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }

  static parseError(err: unknown): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof Error) return new AppError('UNKNOWN', err.message);
    return new AppError('UNKNOWN', 'Unknown error');
  }
}
