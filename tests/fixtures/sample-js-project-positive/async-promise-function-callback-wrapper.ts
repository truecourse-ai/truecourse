// Wrapping a callback-based API in `new Promise(...)` is the legitimate way
// to bridge non-await-able code into the promise world. The function CAN'T
// be rewritten as `async` because there is no Promise to await — the caller
// passes a continuation that resolves later. Same applies to the
// deferred-resolver pattern where `resolve` is stored for later invocation
// by an unrelated code path.

interface CallbackApi {
  fetch(cb: (err: Error | null, value: number) => void, options: { dst: string }): void;
}

export function readValue(api: CallbackApi, dst: string): Promise<number> {
  return new Promise((resolve, reject) => {
    api.fetch(
      (err, value) => {
        if (err) return reject(err);
        resolve(value);
      },
      { dst },
    );
  });
}

interface Listener {
  listen(port: number, host: string, onReady: () => void): void;
  close(onClosed: () => void): void;
}

export function startListener(inner: Listener, port: number, host: string): Promise<void> {
  return new Promise((resolve) => {
    inner.listen(port, host, () => {
      resolve();
    });
  });
}

export function stopListener(inner: Listener): Promise<void> {
  return new Promise((resolve) => {
    inner.close(() => {
      resolve();
    });
  });
}

type Resolver<T> = (value: T) => void;

export class DeferredResolverPool<T> {
  private readonly resolversById = new Map<string, Resolver<T>>();

  awaitOne(id: string): Promise<T> {
    return new Promise<T>((resolve) => {
      this.resolversById.set(id, resolve);
    });
  }

  fulfill(id: string, value: T): void {
    const r = this.resolversById.get(id);
    if (r) {
      this.resolversById.delete(id);
      r(value);
    }
  }
}
