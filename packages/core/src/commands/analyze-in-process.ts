/**
 * Thin wrapper over `analyzeCore` + `persistFullAnalysis`. Exists for
 * backwards compatibility — CLI and routes import `analyzeInProcess` from
 * `@truecourse/core/commands/analyze-in-process`, and this keeps that surface stable even as
 * the internal split becomes core-compute vs mode-specific-persist.
 */

import { removeFromHistory } from '../lib/analysis-store.js';
import type { RegistryEntry } from '../config/registry.js';
import type { LLMProvider } from '../services/llm/provider.js';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { StepTracker } from '../progress.js';
import { analyzeCore, type LlmEstimate } from './analyze-core.js';
import { persistFullAnalysis, type PersistFullResult } from './analyze-persist.js';
import { config } from '../config/index.js';
import { log } from '../lib/logger.js';
import {
  bucketDuration,
  bucketFileCount,
  detectLanguages,
  trackEvent,
  type TelemetrySource,
} from '../services/telemetry.service.js';

export type { LlmEstimate };

export interface AnalyzeInProcessOptions {
  branch?: string | null;
  commitHash?: string | null;
  /** Skip all git commands (branch detection, commit hash, diff). */
  skipGit?: boolean;
  /**
   * Analyze the working tree as-is instead of stashing dirty changes first.
   * The CLI sets this from `--no-stash` (or after the user declines the
   * stash prompt). Defaults to `false` (stash if dirty).
   */
  skipStash?: boolean;
  enabledCategoriesOverride?: string[];
  enableLlmRulesOverride?: boolean;
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  onLlmResolved?: (proceed: boolean) => void;
  provider?: LLMProvider;
  /** LLM transport for the auto-created provider (cli default; agent for headless). */
  transport?: LlmTransport;
  signal?: AbortSignal;
  /**
   * Adapter that triggered this run. Auto-emitted in the telemetry payload so
   * we can attribute analyses to CLI vs dashboard. Omit to skip telemetry.
   */
  source?: TelemetrySource;
}

export type AnalyzeInProcessResult = PersistFullResult;

export async function analyzeInProcess(
  project: RegistryEntry,
  options: AnalyzeInProcessOptions = {},
): Promise<AnalyzeInProcessResult> {
  const startedAt = Date.now();
  log.info(
    `[LLM] Provider: claude-code, model: ${config.claudeCodeModel || 'default'}, maxConcurrency: ${config.claudeCodeMaxConcurrency}`,
  );
  const core = await analyzeCore(project, { ...options, mode: 'full' });
  const result = persistFullAnalysis(project, core, startedAt);

  if (options.source) {
    await trackEvent('analyze', {
      source: options.source,
      mode: 'full',
      serviceCount: result.serviceCount,
      fileCountRange: bucketFileCount(result.fileCount),
      languages: detectLanguages(core.analysisResult),
      architecture: result.architecture,
      durationRange: bucketDuration(result.durationMs),
    });
  }

  return result;
}

// Re-export so the route can detect and remove a specific analysis's history entry.
export { removeFromHistory };
