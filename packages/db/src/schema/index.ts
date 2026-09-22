export * from './activity.js';
import { activityRuns, activityEvents } from './activity.js';
/**
 * The full Postgres schema, composed from per-feature files. One schema, one
 * migration history, one `migrate()` — see `../db.ts`.
 */

export * from './repositories.js';
export * from './integrations.js';
export * from './llm.js';
export * from './content.js';
export * from './decisions.js';
export * from './workspace-spec.js';
export * from './cache.js';
export * from './jobs.js';
export * from './guard.js';
export * from './context.js';
export * from './workspace-invite-links.js';
export * from './workspace-profile.js';
export * from './llm-usage.js';
export * from './credits.js';
export * from './entitlements.js';
export * from './pull-requests.js';

import { providerAccounts, providerAccountLinks, repositories } from './repositories.js';
import { llmProviderConfig } from './llm.js';
import { content } from './content.js';
import { decisions } from './decisions.js';
import { extractionCache } from './cache.js';
import { workspaceSpecSets } from './workspace-spec.js';
import { jobs, notifications } from './jobs.js';
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
import { workspaceInviteLinks } from './workspace-invite-links.js';
import { workspaceProfiles } from './workspace-profile.js';
import { llmUsage } from './llm-usage.js';
import { creditLedger, creditBalances } from './credits.js';
import { workspaceEntitlements } from './entitlements.js';
import { pullRequests, pullRequestChecks } from './pull-requests.js';

export const schema = {
  activityRuns,
  activityEvents,
  providerAccounts,
  providerAccountLinks,
  repositories,
  llmProviderConfig,
  content,
  decisions,
  extractionCache,
  workspaceSpecSets,
  jobs,
  notifications,
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
  workspaceInviteLinks,
  workspaceProfiles,
  llmUsage,
  creditLedger,
  creditBalances,
  workspaceEntitlements,
  pullRequests,
  pullRequestChecks,
};
