/**
 * Thin wrapper over `analyzeCore` + `persistFullAnalysis`. Exists for
 * backwards compatibility — CLI and routes import `analyzeInProcess` from
 * `@truecourse/server/analyze`, and this keeps that surface stable even as
 * the internal split becomes core-compute vs mode-specific-persist.
 */

import { removeFromHistory } from '../lib/analysis-store.js';
import type { RegistryEntry } from '../config/registry.js';
import type { LLMProvider } from '../services/llm/provider.js';
import type { StepTracker } from '../socket/handlers.js';
import { analyzeCore, type LlmEstimate } from './analyze-core.js';
import { persistFullAnalysis, type PersistFullResult } from './analyze-persist.js';

export type { LlmEstimate };

export interface AnalyzeInProcessOptions {
  branch?: string | null;
  commitHash?: string | null;
  /** Skip all git commands (branch detection, commit hash, diff). */
  skipGit?: boolean;
  enabledCategoriesOverride?: string[];
  enableLlmRulesOverride?: boolean;
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
  provider?: LLMProvider;
  signal?: AbortSignal;
}

export type AnalyzeInProcessResult = PersistFullResult;

export async function analyzeInProcess(
  project: RegistryEntry,
  options: AnalyzeInProcessOptions = {},
): Promise<AnalyzeInProcessResult> {
  const startedAt = Date.now();
  const core = await analyzeCore(project, { ...options, mode: 'full' });
  return persistFullAnalysis(project, core, startedAt);
}

// Re-export so the route can detect and remove a specific analysis's history entry.
export { removeFromHistory };
