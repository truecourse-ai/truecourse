/**
 * EE-only Postgres stores. The shared store implementations (analyses, specs,
 * guard, config, registry, caches, locks, and the content-addressed pool they
 * build on) live in `@truecourse/data-store` in the base product and are
 * re-exported here so EE consumers keep a single import surface. What remains
 * in this package is hosted-edition machinery: the job queue, workspace
 * knowledge, LLM traces, and workspace settings.
 */

export {
  ContentStore,
  contentScope,
  sha256,
  PgAnalysisStore,
  PgRepoConfigStore,
  PgUiStateStore,
  PgRegistryStore,
  GhReposRegistryStore,
  PgSpecStore,
  PgGuardStore,
  PgInferredActionStore,
  PgKvCacheStore,
  PgAnalyzeLock,
} from '@truecourse/data-store';
export { PgKnowledgeStore, type KnowledgeDocRow } from './knowledge-store.js';
export {
  JobStore,
  NotificationStore,
  ActiveJobExistsError,
  PendingBaselineStore,
  PendingGuardBaselineStore,
  GuardBackfillMarkerStore,
  type OrphanedJob,
  type PendingBaselineInput,
  type PendingBaselineView,
  type PendingGuardBaselineInput,
  type PendingGuardBaselineView,
} from './jobs-store.js';
export { PgTraceStore } from './trace-store.js';
export { WorkspaceSettingsStore, type WorkspaceSettings } from './workspace-settings-store.js';
