/**
 * Thin wrapper over `analyzeCore` + `persistDiffAnalysis`. Kept for
 * backwards compatibility with:
 *   - `POST /api/repos/:id/diff-check`
 *   - `truecourse analyze --diff`
 * Both import `diffInProcess` from `@truecourse/core/commands/diff-in-process`.
 */

import type { RegistryEntry } from '../config/registry.js';
import type { StepTracker } from '../progress.js';
import { analyzeCore, type LlmEstimate } from './analyze-core.js';
import { persistDiffAnalysis, type PersistDiffResult } from './analyze-persist.js';
import {
  bucketDuration,
  detectLanguages,
  trackEvent,
  type TelemetrySource,
} from '../services/telemetry.service.js';

export interface DiffInProcessOptions {
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  signal?: AbortSignal;
  enableLlmRulesOverride?: boolean;
  enabledCategoriesOverride?: string[];
  specCompliance?: boolean;
  specComplianceOnly?: boolean;
  specs?: string[];
  showSatisfied?: boolean;
  noLlm?: boolean;
  /**
   * Accepted for symmetry with `analyzeInProcess`. Diff mode always analyzes
   * the working tree as-is, so this is effectively a no-op — kept on the
   * type so the CLI can thread the flag without conditional plumbing.
   */
  skipStash?: boolean;
  /** Pre-flight prompt hook — same contract as `analyzeInProcess`. */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
  /**
   * Adapter that triggered this run. Auto-emitted in the telemetry payload so
   * we can attribute diff runs to CLI vs dashboard. Omit to skip telemetry.
   */
  source?: TelemetrySource;
}

export type DiffInProcessResult = PersistDiffResult;

export async function diffInProcess(
  project: RegistryEntry,
  options: DiffInProcessOptions = {},
): Promise<DiffInProcessResult> {
  const startedAt = Date.now();
  const core = await analyzeCore(project, { ...options, mode: 'diff' });
  const result = persistDiffAnalysis(project, core);

  if (options.source) {
    await trackEvent('analyze', {
      source: options.source,
      mode: 'diff',
      languages: detectLanguages(core.analysisResult),
      changedFileCount: result.diff.changedFiles.length,
      newViolations: result.diff.summary.newCount,
      resolvedViolations: result.diff.summary.resolvedCount,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  return result;
}
