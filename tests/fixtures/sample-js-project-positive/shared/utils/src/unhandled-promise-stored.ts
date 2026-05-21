// Promise-returning calls that are *assigned* somewhere (an object
// property or a ref) — they're retained, not floating, and can be
// awaited or chained later by the holder.

declare function fetchRemote(): Promise<string>;

const cache = new Map<string, Promise<string>>();

export function ensureFetch(key: string): Promise<string> {
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchRemote();
    cache.set(key, pending);
  }
  return pending;
}

const pendingRef: { current: Promise<string> | null } = { current: null };

export async function autosave(): Promise<void> {
  pendingRef.current = fetchRemote();
  try {
    await pendingRef.current;
  } finally {
    pendingRef.current = null;
  }
}

export function makeResolverPair<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  const handle: { resolve: (value: T) => void } = {
    resolve: () => undefined,
  };
  const promise = new Promise<T>((res) => {
    handle.resolve = res;
  });
  return { promise, resolve: handle.resolve };
}
