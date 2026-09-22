/**
 * `@truecourse/llm` — the LLM-stage cache seam. The transport itself lives in
 * `@truecourse/shared/llm`; this package is only the content-addressed cache
 * the engine's runners read to skip re-running the model for unchanged inputs.
 * Boot installs the Postgres `KvCacheStore` over it.
 */

export {
  type KvCacheStore,
  getKvCacheStore,
  setKvCacheStore,
  resetKvCacheStore,
  getCacheEntry,
  setCacheEntry,
  getCacheEntryOrLegacy,
} from './cache-store.js';
