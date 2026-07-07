// A request-throttling helper. The incoming authorization header is reduced
// to a fast digest purely to build a cache key — the digest is never stored
// or treated as a credential, so salting would add nothing here. An unrelated
// connection option in the same function happens to be named `password`; that
// must not be mistaken for a password-hashing context.

interface Hash {
  update(_input: string): Hash;
  digest(_encoding: string): string;
}

interface CacheConnectionOptions {
  readonly host: string;
  readonly password: string;
}

interface ThrottledRequest {
  readonly authorization: string;
}

declare function createHash(_algorithm: string): Hash;
declare function openCacheConnection(_options: CacheConnectionOptions): void;

export function buildThrottleCacheKey(
  request: ThrottledRequest,
  connection: CacheConnectionOptions,
): string {
  openCacheConnection({ host: connection.host, password: connection.password });

  const digest = createHash("sha256");
  digest.update(request.authorization);
  return digest.digest("hex");
}
