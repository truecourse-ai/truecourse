/**
 * Thin wrapper over `analyzeCore` + `persistDiffAnalysis`. Kept for
 * backwards compatibility with:
 *   - `POST /api/repos/:id/diff-check`
 *   - `truecourse analyze --diff`
 * Both import `diffInProcess` from `@truecourse/server/diff`.
 */

import type { RegistryEntry } from '../config/registry.js';
import type { StepTracker } from '../socket/handlers.js';
import { analyzeCore, type LlmEstimate } from './analyze-core.js';
import { persistDiffAnalysis, type PersistDiffResult } from './analyze-persist.js';

export interface DiffInProcessOptions {
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  signal?: AbortSignal;
  enableLlmRulesOverride?: boolean;
  enabledCategoriesOverride?: string[];
  /** Pre-flight prompt hook — same contract as `analyzeInProcess`. */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
}

export type DiffInProcessResult = PersistDiffResult;

export async function diffInProcess(
  project: RegistryEntry,
  options: DiffInProcessOptions = {},
): Promise<DiffInProcessResult> {
  const core = await analyzeCore(project, { ...options, mode: 'diff' });
  return persistDiffAnalysis(project, core);
}
