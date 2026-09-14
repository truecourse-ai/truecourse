export * from './activity.js';
import { activityRuns, activityEvents } from './activity.js';
/**
 * The full Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './github.js';
export * from './llm.js';
export * from './content.js';
export * from './decisions.js';
export * from './contracts.js';
export * from './workspace-spec.js';
export * from './cache.js';
export * from './integrations.js';
export * from './jobs.js';
export * from './guard.js';
export * from './context.js';

import { ghInstallations, ghRepos, ghBaselines, ghRuns, ghPrs } from './github.js';
import { llmProviderConfig } from './llm.js';
import { content } from './content.js';
import { decisions } from './decisions.js';
import { specSets } from './contracts.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets } from './workspace-spec.js';
import { integrationConnections } from './integrations.js';
import {
  jobs,
  notifications,
  pendingBaselines,
  pendingGuardBaselines,
  guardBackfillMarkers,
} from './jobs.js';
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
  ghInstallations,
  ghRepos,
  ghBaselines,
  ghRuns,
  ghPrs,
  llmProviderConfig,
  content,
  decisions,
  specSets,
  extractionCache,
  workspaceSpecSets,
  integrationConnections,
  jobs,
  notifications,
  pendingBaselines,
  pendingGuardBaselines,
  guardBackfillMarkers,
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
