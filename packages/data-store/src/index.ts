/**
 * Postgres implementations of core's storage seams. The dashboard server
 * installs these via the `setXStore` setters so the whole pipeline reads and
 * writes the database instead of a repo's `.truecourse/` tree — the working
 * copy becomes an ephemeral per-run clone. All content lives in Postgres:
 * bulky bodies are content-addressed in the `content` table; no blob store.
 */

export { ContentStore, contentScope } from './content-store.js';
export { sha256 } from './pack.js';
export { PgAnalysisStore } from './analysis-store.js';
export { PgRepoConfigStore, PgUiStateStore } from './config-store.js';
export { PgRegistryStore } from './registry-store.js';
export { GhReposRegistryStore } from './gh-repos-registry-store.js';
export { PgSpecStore } from './spec-store.js';
export { PgGuardStore } from './guard-store.js';
export { PgInferredActionStore } from './inferred-action-store.js';
export { PgKvCacheStore } from './cache-store.js';
export { PgAnalyzeLock } from './analyze-lock.js';
