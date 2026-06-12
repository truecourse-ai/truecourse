/**
 * Hosted (Postgres) implementations of core's spec/contract/verify store seams.
 * The enterprise server installs these via `setVerifyStore` / `setContractStore`
 * / `setSpecStore` so the whole pipeline reads and writes server-side instead of
 * the customer's `.truecourse/` tree. All content lives in Postgres — bulky
 * bodies are content-addressed in the `content` table; no blob store. Wired in
 * `@truecourse/ee-server`.
 */

export { ContentStore, contentScope } from './content-store.js';
export { PgVerifyStore } from './verify-store.js';
export { PgRepoConfigStore, PgUiStateStore } from './config-store.js';
export { PgRegistryStore } from './registry-store.js';
export { GhReposRegistryStore } from './gh-repos-registry-store.js';
export { PgContractStore } from './contract-store.js';
export { PgSpecStore } from './spec-store.js';
export { PgKnowledgeStore, type KnowledgeDocRow } from './knowledge-store.js';
export { JobStore, NotificationStore, ActiveJobExistsError } from './jobs-store.js';
export { PgKvCacheStore } from './cache-store.js';
export { PgTraceStore } from './trace-store.js';
export { PgAnalyzeLock } from './analyze-lock.js';
export { gcContractObjects, type GcResult, type GcOptions } from './contract-gc.js';
