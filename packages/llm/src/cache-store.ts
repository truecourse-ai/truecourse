/**
 * The key-value store behind the LLM-stage caches — the per-session and
 * per-slice outcomes a re-run reads instead of paying for the model again.
 *
 * Keys are content hashes, so a hit is valid across runs, commits and clones,
 * which is what keeps re-runs cheap now that every run's working tree is
 * discarded. The seam exists because the engine packages cannot depend on
 * `@truecourse/data-store`: boot installs the Postgres store over it.
 *
 * With nothing installed every read MISSES and every write is dropped: a cache
 * is an optimization, and a run without one is correct, only slower. `scope`
 * names the repository a key belongs to; the content-addressed store ignores it.
 */

export interface KvCacheStore {
  /** The cached JSON value, or `null` on a miss. */
  get(scope: string, cacheName: string, key: string): Promise<unknown | null>;
  /** Store (overwrite) the JSON value. */
  set(scope: string, cacheName: string, key: string, value: unknown): Promise<void>;
}

const NO_CACHE: KvCacheStore = {
  async get() {
    return null;
  },
  async set() {
    /* nothing to store into */
  },
};

let active: KvCacheStore = NO_CACHE;

/** The active KV cache store. */
export function getKvCacheStore(): KvCacheStore {
  return active;
}
/** Install the KV cache store (boot: the Postgres one). */
export function setKvCacheStore(store: KvCacheStore): void {
  active = store;
}
/** Forget the installed store, so every stage misses again (tests). */
export function resetKvCacheStore(): void {
  active = NO_CACHE;
}

export const getCacheEntry = (
  scope: string,
  cacheName: string,
  key: string,
): Promise<unknown | null> => active.get(scope, cacheName, key);
export const setCacheEntry = (
  scope: string,
  cacheName: string,
  key: string,
  value: unknown,
): Promise<void> => active.set(scope, cacheName, key, value);

/**
 * THE OLD-KEY READ — one entry, looked up under the key a stage computes now
 * and, on a miss, under each key it computed before its formula changed, newest
 * formula first. A legacy hit is served AND written under the new key, so the
 * fallback is paid at most once per entry and the next run finds it directly.
 *
 * Every cache whose key formula changes reads this way, because without it a
 * formula change bills every workspace one full re-run of that stage — which is
 * exactly the cost the change exists to remove. A stage whose formula has moved
 * twice hands both old keys, so an entry stored under either is still served.
 * It goes away with the legacy keys themselves.
 */
export const getCacheEntryOrLegacy = async (
  scope: string,
  cacheName: string,
  key: string,
  ...legacyKeys: readonly string[]
): Promise<unknown | null> => {
  const current = await active.get(scope, cacheName, key);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    if (legacyKey === key) continue;
    const legacy = await active.get(scope, cacheName, legacyKey);
    if (legacy === null) continue;
    await active.set(scope, cacheName, key, legacy);
    return legacy;
  }
  return null;
};
