
// --- function-return-type-varies shape: T|undefined sentinel (CORS origin resolver) ---
// Returns undefined as a sentinel meaning 'no CORS headers needed'; the caller
// checks explicitly and skips header merging. Returning T|undefined from an
// async function is standard TypeScript; Promise<Headers|undefined> is correct.
declare function computeOriginHeaders(origin: string | undefined, allowed: string | boolean): Headers;
declare type OriginFn = (origin: string | undefined, req: Request) => Promise<string | boolean>;

async function resolveOriginHeaders(
  req: Request,
  origin: string | boolean | OriginFn,
): Promise<Headers | undefined> {
  const reqOrigin = req.headers.get('Origin') ?? undefined;
  const value = typeof origin === 'function' ? await origin(reqOrigin, req) : origin;

  if (!value) {
    return;
  }

  return computeOriginHeaders(reqOrigin, value);
}
