// `update` and `run` are method names overloaded by Node's crypto Hash
// objects (`hash.update(buf)`), `AsyncLocalStorage.run(store, fn)`, and
// generic task-runner receivers. None of these write to a database, so
// firing on every `.update()` / `.run()` produces ~100% FPs on
// non-DB code. Require an ORM-shaped receiver to keep flagging real
// writes.

interface IncomingRequest {
  readonly headers: Record<string, string>;
  readonly body: { readonly token: string };
}

interface Hash {
  update(_buf: Buffer): Hash;
  digest(_encoding: string): string;
}

interface AsyncStorage<T> {
  run<R>(_store: T, _fn: () => R): R;
}

declare function createHash(_algo: string): Hash;
declare const tenantStorage: AsyncStorage<{ readonly tenantId: string }>;

export function hashAuthToken(req: IncomingRequest): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(req.body.token, "utf8"));
  return hash.digest("hex");
}

export function withTenantContext<R>(req: IncomingRequest, fn: () => R): R {
  return tenantStorage.run({ tenantId: req.headers["x-tenant-id"] }, fn);
}
