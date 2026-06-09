/**
 * The full ee Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './github.js';
export * from './llm.js';
export * from './blobs.js';
export * from './data.js';
export * from './config.js';
export * from './contracts.js';
export * from './cache.js';
export * from './knowledge.js';
export * from './integrations.js';
export * from './jobs.js';
export * from './traces.js';

import { ghInstallations, ghRepos, ghBaselines, ghRuns } from './github.js';
import { llmProviderConfig } from './llm.js';
import { blobs } from './blobs.js';
import { analyses, analysisHistory, verifyRuns, verifyHistory } from './data.js';
import { repoConfig, repoUiState, registry } from './config.js';
import { contractSets, specSets } from './contracts.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets, workspaceContractSets, knowledgeDocuments } from './knowledge.js';
import { integrationConnections } from './integrations.js';
import { jobs, notifications } from './jobs.js';
import { llmTraces } from './traces.js';

export const schema = {
  ghInstallations,
  ghRepos,
  ghBaselines,
  ghRuns,
  llmProviderConfig,
  blobs,
  analyses,
  analysisHistory,
  verifyRuns,
  verifyHistory,
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
};
