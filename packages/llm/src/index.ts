/**
 * `@truecourse/llm` — the pluggable LLM-stage cache seam. The LLM transport
 * itself now lives in `@truecourse/shared/llm` (cli + agent backends); this
 * package is just the content-addressed cache the IL runners use to skip
 * re-running the model for unchanged inputs. The file-backed default keeps the
 * OSS `.truecourse/.cache/` layout; the enterprise edition injects a Postgres
 * `KvCacheStore` via `setKvCacheStore`.
 */

export {
  type KvCacheStore,
  getKvCacheStore,
  setKvCacheStore,
  resetKvCacheStore,
  getCacheEntry,
  setCacheEntry,
} from './cache-store.js';
