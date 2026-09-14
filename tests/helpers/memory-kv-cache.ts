/**
 * The LLM-stage cache, held in memory — the test double for any suite that
 * proves a stage is CACHED (a warm entry answers without a call, a failure is
 * never written, a re-run is free).
 *
 * With nothing installed every read misses and every write is dropped, which is
 * correct for production (a run without a cache is only slower) but makes a
 * cache test assert nothing. Install this instead.
 */

import { setKvCacheStore as setKvCacheByPackage, resetKvCacheStore as resetKvCacheByPackage, type KvCacheStore } from '@truecourse/llm';
import { setKvCacheStore as setKvCacheBySource, resetKvCacheStore as resetKvCacheBySource } from '../../packages/llm/src/index';

/** One held entry, with its address kept in parts. */
export interface MemoryKvCacheEntry {
  scope: string;
  cacheName: string;
  key: string;
  value: unknown;
}

export class MemoryKvCacheStore implements KvCacheStore {
  private readonly entries = new Map<string, MemoryKvCacheEntry>();

  private at(scope: string, cacheName: string, key: string): string {
    return [scope, cacheName, key].join(' ');
  }

  async get(scope: string, cacheName: string, key: string): Promise<unknown | null> {
    return this.entries.get(this.at(scope, cacheName, key))?.value ?? null;
  }

  async set(scope: string, cacheName: string, key: string, value: unknown): Promise<void> {
    this.entries.set(this.at(scope, cacheName, key), { scope, cacheName, key, value });
  }

  /** How many entries are held — what a "wrote nothing" assertion reads. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Every held entry, with its address in parts — so a test can narrow to one
   * stage's cache and write a mutated value back through `set`, which is how a
   * cache-SHAPE case (an entry written in an older shape is still a hit) is
   * expressed.
   */
  list(): MemoryKvCacheEntry[] {
    return [...this.entries.values()];
  }
}

/**
 * Install the in-memory cache for a suite. Pair with {@link resetKvCacheStore}.
 *
 * Installed through BOTH specifiers a test can reach the seam by — the package
 * (which resolves to the built `dist`) and the source path — because a test
 * imports the code under test either way, and the two are separate module
 * instances with separate state.
 */
export function installMemoryKvCache(): MemoryKvCacheStore {
  const store = new MemoryKvCacheStore();
  setKvCacheByPackage(store);
  setKvCacheBySource(store);
  return store;
}

export function resetKvCacheStore(): void {
  resetKvCacheByPackage();
  resetKvCacheBySource();
}
