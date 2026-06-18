/**
 * The full ee Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './github.js';
export * from './llm.js';
export * from './content.js';
export * from './verify.js';
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

import { ghInstallations, ghRepos, ghBaselines, ghRuns, ghInferredActions } from './github.js';
import { llmProviderConfig } from './llm.js';
import { content } from './content.js';
import { verifySnapshots } from './verify.js';
import { analyses, analysisCurrent, analysisHistory } from './analyses.js';
import { decisions } from './decisions.js';
import { repoConfig, repoUiState, registry } from './config.js';
import { contractSets, specSets } from './contracts.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets, workspaceContractSets, knowledgeDocuments } from './knowledge.js';
import { integrationConnections } from './integrations.js';
import { jobs, notifications } from './jobs.js';
import { llmTraces } from './traces.js';
import { workspaceSettings } from './settings.js';

export const schema = {
  ghInstallations,
  ghRepos,
  ghBaselines,
  ghRuns,
  ghInferredActions,
  llmProviderConfig,
  content,
  verifySnapshots,
  analyses,
  analysisCurrent,
  analysisHistory,
  decisions,
  repoConfig,
  repoUiState,
  registry,
  contractSets,
  specSets,
  extractionCache,
  workspaceSpecSets,
  workspaceContractSets,
  knowledgeDocuments,
  integrationConnections,
  jobs,
  notifications,
  llmTraces,
  workspaceSettings,
};
