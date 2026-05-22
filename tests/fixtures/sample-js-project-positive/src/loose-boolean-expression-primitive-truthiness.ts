/**
 * Positive fixture for bugs/deterministic/loose-boolean-expression.
 *
 * `if (value)` on `string`, `number`, `boolean`, or any of these unioned
 * with `null`/`undefined` is the idiomatic JS/TS null-or-empty guard. The
 * canonical examples below all came back from
 * @typescript-eslint/strict-boolean-expressions but flood codebases with
 * noise without catching real bugs.
 */

export const allowExposed = (
  exposedHeaders: readonly string[] | string | undefined,
): string | null => {
  const exposed = Array.isArray(exposedHeaders)
    ? exposedHeaders.join(',')
    : exposedHeaders;
  if (exposed) {
    return exposed;
  }
  return null;
};

export const firstNonEmptyHeader = (
  headers: ReadonlyMap<string, string | null>,
  names: readonly string[],
): string | null => {
  for (const name of names) {
    const value = headers.get(name) ?? null;
    if (value) {
      return value;
    }
  }
  return null;
};

interface CorsOptions {
  credentials?: boolean;
}

export const applyCredentials = (
  opts: CorsOptions,
  headers: Map<string, string>,
): void => {
  if (opts.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
};
