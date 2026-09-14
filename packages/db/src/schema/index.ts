export * from './activity.js';
import { activityRuns, activityEvents } from './activity.js';
/**
 * The full Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './github.js';
export * from './repositories.js';
export * from './llm.js';
export * from './content.js';
export * from './decisions.js';
export * from './contracts.js';
export * from './workspace-spec.js';
export * from './cache.js';
export * from './jobs.js';
export * from './guard.js';
export * from './context.js';

import { ghBaselines, ghRuns, ghPrs } from './github.js';
import { providerAccounts, repositories } from './repositories.js';
import { llmProviderConfig } from './llm.js';
import { content } from './content.js';
import { decisions } from './decisions.js';
import { specSets } from './contracts.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets } from './workspace-spec.js';
import { jobs, notifications, pendingGuardBaselines } from './jobs.js';
import {
  guardRuns,
  guardResults,
  guardScenarioSets,
  guardSetupSets,
  guardDependencyOverlays,
} from './guard.js';
import {
  contextSources,
  contextSyncs,
  contextDocuments,
  contextBindings,
  contextWorkspaces,
} from './context.js';

export const schema = {
  activityRuns,
  activityEvents,
  providerAccounts,
  repositories,
  ghBaselines,
  ghRuns,
  ghPrs,
  llmProviderConfig,
  content,
  decisions,
  specSets,
  extractionCache,
  workspaceSpecSets,
  jobs,
  notifications,
  pendingGuardBaselines,
  guardRuns,
  guardResults,
  guardScenarioSets,
  guardSetupSets,
  guardDependencyOverlays,
  contextSources,
  contextSyncs,
  contextDocuments,
  contextBindings,
  contextWorkspaces,
};
