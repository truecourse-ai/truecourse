/**
 * The full ee Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './github.js';
export * from './llm.js';
export * from './content.js';
export * from './analyses.js';
export * from './decisions.js';
export * from './config.js';
export * from './contracts.js';
export * from './cache.js';
export * from './knowledge.js';
export * from './integrations.js';
export * from './jobs.js';
export * from './traces.js';
export * from './settings.js';
export * from './guard.js';

import { ghInstallations, ghRepos, ghBaselines, ghRuns, ghInferredActions, ghPrs } from './github.js';
import { llmProviderConfig } from './llm.js';
import { content } from './content.js';
import { analyses, analysisCurrent, analysisHistory } from './analyses.js';
import { decisions } from './decisions.js';
import { repoConfig, repoUiState, registry } from './config.js';
import { specSets } from './contracts.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets, knowledgeDocuments } from './knowledge.js';
import { integrationConnections } from './integrations.js';
import {
  jobs,
  notifications,
  pendingBaselines,
  pendingGuardBaselines,
  guardBackfillMarkers,
} from './jobs.js';
import { llmTraces } from './traces.js';
import { workspaceSettings } from './settings.js';
import { guardRuns, guardResults, guardScenarioSets } from './guard.js';

export const schema = {
  ghInstallations,
  ghRepos,
  ghBaselines,
  ghRuns,
  ghInferredActions,
  ghPrs,
  llmProviderConfig,
  content,
  analyses,
  analysisCurrent,
  analysisHistory,
  decisions,
  repoConfig,
  repoUiState,
  registry,
  specSets,
  extractionCache,
  workspaceSpecSets,
  knowledgeDocuments,
  integrationConnections,
  jobs,
  notifications,
  pendingBaselines,
  pendingGuardBaselines,
  guardBackfillMarkers,
  llmTraces,
  workspaceSettings,
  guardRuns,
  guardResults,
  guardScenarioSets,
};
