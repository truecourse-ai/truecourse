/**
 * Pluggable key-value store for the LLM-stage caches (per-slice extraction
 * results, per-block extractions). File-backed by default — entries live under
 * `<scope>/.truecourse/.cache/<cacheName>/<key>.json`, exactly as before — so the
 * OSS/local edition is unchanged. The enterprise edition injects a Postgres-
 * backed impl via `setKvCacheStore` so the load-bearing cache survives ephemeral
 * clones: keys are content hashes (slice/block id + prompt fingerprint), so an
 * unchanged slice/block hits the cache across runs and commits and skips the LLM.
 *
 * The seam lives here in `@truecourse/llm` because both IL packages
 * (`contract-extractor`, `spec-consolidator`) depend on it directly and these
 * are LLM-result caches. `scope` is the repo root: the file impl uses it as the
 * cache directory location; the (content-addressed) EE impl ignores it.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface KvCacheStore {
  /** The cached JSON value, or `null` on a miss. */
  get(scope: string, cacheName: string, key: string): Promise<unknown | null>;
  /** Store (overwrite) the JSON value. */
  set(scope: string, cacheName: string, key: string, value: unknown): Promise<void>;
}

class FileKvCacheStore implements KvCacheStore {
  private file(scope: string, cacheName: string, key: string): string {
    return path.join(scope, '.truecourse', '.cache', cacheName, `${key}.json`);
  }

  async get(scope: string, cacheName: string, key: string): Promise<unknown | null> {
    const file = this.file(scope, cacheName, key);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      // Malformed entry — treat as a miss so the next run rewrites it.
      return null;
    }
  }

  async set(scope: string, cacheName: string, key: string, value: unknown): Promise<void> {
    const file = this.file(scope, cacheName, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  }
}

let active: KvCacheStore = new FileKvCacheStore();

/** The active KV cache store (file-backed unless EE installed a Postgres one). */
export function getKvCacheStore(): KvCacheStore {
  return active;
}
/** Install a KV cache store (e.g. the enterprise Postgres impl). */
export function setKvCacheStore(store: KvCacheStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetKvCacheStore(): void {
  active = new FileKvCacheStore();
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
