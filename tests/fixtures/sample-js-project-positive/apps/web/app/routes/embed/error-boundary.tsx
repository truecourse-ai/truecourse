
// .with(404, () => ...) pattern matches the standard HTTP Not Found status code
declare function match<T>(val: T): { with(pattern: unknown, fn: () => unknown): { otherwise(fn: () => unknown): unknown } };
declare function isRouteErrorResponse(err: unknown): err is { status: number };
declare const error: unknown;

function renderEmbedError() {
  const errorCode = isRouteErrorResponse(error) ? error.status : 500;

  return match(errorCode)
    .with(404, () => ({ type: 'not-found', message: 'Token Not Found' }))
    .otherwise(() => ({ type: 'generic', message: 'An unexpected error occurred' }));
}
