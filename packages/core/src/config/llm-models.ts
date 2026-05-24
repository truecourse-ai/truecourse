/**
 * Per-stage LLM model configuration.
 *
 * Every pipeline stage that shells out to the Claude CLI has a stable
 * stage ID (e.g. `spec.chainDetect`, `contract.extract`). Defaults are
 * baked into each runner; users override on a per-stage basis via
 * env vars or `.truecourse/config.json`.
 *
 * Resolution order (highest precedence first):
 *
 *   1. Per-stage env var: `TRUECOURSE_MODEL_<STAGE_ID_UPPER_WITH_UNDERSCORES>`
 *   2. Global env var:    `TRUECOURSE_MODEL`
 *   3. Per-stage value in config.json under `llm.stages.<stageId>`
 *   4. In-code default supplied by the caller
 *
 * Fallback model (used by the CLI's `--fallback-model` flag when the
 * primary is overloaded) resolves the same way against
 * `TRUECOURSE_FALLBACK_MODEL` / `llm.fallbackModel`.
 *
 * Legacy `CLAUDE_CODE_MODEL` is honored as an alias for
 * `TRUECOURSE_MODEL` with a one-time deprecation log on first read.
 *
 * Stage IDs are intentionally stable strings — renaming a runner file
 * doesn't change the ID, so user config doesn't break.
 */

import fs from 'node:fs';
import { getRepoConfigPath, resolveRepoDir } from './paths.js';

export type StageId =
  | 'spec.chainDetect'
  | 'spec.claimExtract'
  | 'spec.chainRecheck'
  | 'spec.conflictExplain'
  | 'spec.conflictResolve'
  | 'spec.relevance'
  | 'contract.extract'
  | 'contract.repair'
  | 'rules.violationGen';

/**
 * Default model per stage when the user hasn't configured an override.
 * Picked to balance cost vs. output quality on the stage's task
 * difficulty. Tunable here without touching the runners.
 */
export const STAGE_DEFAULTS: Record<StageId, string> = {
  'spec.chainDetect': 'haiku',
  'spec.claimExtract': 'sonnet',
  'spec.chainRecheck': 'sonnet',
  'spec.conflictExplain': 'haiku',
  'spec.conflictResolve': 'opus',
  'spec.relevance': 'haiku',
  'contract.extract': 'opus',
  'contract.repair': 'opus',
  'rules.violationGen': 'opus',
};

export interface LlmConfigBlock {
  /** Per-stage overrides keyed by stage ID. */
  stages?: Partial<Record<StageId, string>>;
  /** Model to retry with when the primary is overloaded. */
  fallbackModel?: string;
}

interface ConfigWithLlm {
  llm?: LlmConfigBlock;
}

// One-time deprecation banner — avoid spamming on every resolution.
let warnedLegacyClaudeCodeModel = false;
function maybeWarnLegacy(): void {
  if (warnedLegacyClaudeCodeModel) return;
  if (!process.env.CLAUDE_CODE_MODEL) return;
  if (process.env.TRUECOURSE_MODEL) return;
  warnedLegacyClaudeCodeModel = true;
  process.stderr.write(
    '[truecourse] CLAUDE_CODE_MODEL is deprecated; use TRUECOURSE_MODEL instead. ' +
      'The current value will continue to work as a global override.\n',
  );
}

function stageEnvVar(stageId: StageId): string {
  // spec.chainDetect → SPEC_CHAIN_DETECT
  // contract.extract → CONTRACT_EXTRACT
  const upper = stageId
    .replace(/\./g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toUpperCase();
  return `TRUECOURSE_MODEL_${upper}`;
}

function readConfigSync(repoDir: string): ConfigWithLlm {
  const file = getRepoConfigPath(repoDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ConfigWithLlm;
  } catch {
    return {};
  }
}

/**
 * Resolve the model name for a stage. Falls back to the supplied
 * `defaultModel` (typically pulled from STAGE_DEFAULTS by the caller)
 * if no env or config override applies.
 *
 * `repoDir` is the working repo root; pass `null` to skip config-file
 * lookup (useful in subprocesses that don't know the project path).
 */
export function resolveModel(
  stageId: StageId,
  defaultModel: string = STAGE_DEFAULTS[stageId],
  repoDir: string | null = resolveRepoDir(process.cwd()),
): string {
  // 1. Per-stage env var
  const stageEnv = process.env[stageEnvVar(stageId)];
  if (stageEnv && stageEnv.trim()) return stageEnv.trim();

  // 2. Global env var (TRUECOURSE_MODEL or legacy CLAUDE_CODE_MODEL)
  maybeWarnLegacy();
  const globalEnv = process.env.TRUECOURSE_MODEL || process.env.CLAUDE_CODE_MODEL;
  if (globalEnv && globalEnv.trim()) return globalEnv.trim();

  // 3. Per-stage value in config.json
  if (repoDir) {
    const cfg = readConfigSync(repoDir);
    const stageCfg = cfg.llm?.stages?.[stageId];
    if (stageCfg && stageCfg.trim()) return stageCfg.trim();
  }

  // 4. In-code default
  return defaultModel;
}

/**
 * Resolve the fallback model — what `--fallback-model` should pass
 * when the primary is overloaded. Returns null when no fallback is
 * configured (the CLI then fails loudly on overload).
 */
export function resolveFallbackModel(
  repoDir: string | null = resolveRepoDir(process.cwd()),
): string | null {
  const env = process.env.TRUECOURSE_FALLBACK_MODEL;
  if (env && env.trim()) return env.trim();
  if (repoDir) {
    const cfg = readConfigSync(repoDir);
    if (cfg.llm?.fallbackModel) return cfg.llm.fallbackModel.trim();
  }
  return null;
}

/**
 * Convenience for spawning code: returns the `--model X` (and
 * `--fallback-model Y` if configured) args to append to a `claude -p`
 * invocation. Returns `[]` when the caller wants the CLI default —
 * effectively "no flag, use whatever Claude Code picks." Today every
 * stage has a defined default in STAGE_DEFAULTS, so this is rarely
 * empty in practice.
 */
export function modelArgsForStage(
  stageId: StageId,
  defaultModel: string = STAGE_DEFAULTS[stageId],
  repoDir: string | null = resolveRepoDir(process.cwd()),
): string[] {
  const args: string[] = [];
  const model = resolveModel(stageId, defaultModel, repoDir);
  if (model) {
    args.push('--model', model);
  }
  const fallback = resolveFallbackModel(repoDir);
  if (fallback) {
    args.push('--fallback-model', fallback);
  }
  return args;
}

/**
 * Returns the effective model for every stage, plus where the value
 * came from (`env-stage` | `env-global` | `env-legacy` | `config` |
 * `default`). Used by `truecourse config llm --show`.
 */
export interface StageResolution {
  stageId: StageId;
  effectiveModel: string;
  source: 'env-stage' | 'env-global' | 'env-legacy' | 'config' | 'default';
  envVar?: string;
}

export function describeStageResolutions(
  repoDir: string | null = resolveRepoDir(process.cwd()),
): { stages: StageResolution[]; fallbackModel: string | null } {
  const cfg = repoDir ? readConfigSync(repoDir) : ({} as ConfigWithLlm);
  const stages = (Object.keys(STAGE_DEFAULTS) as StageId[]).map((stageId): StageResolution => {
    const envName = stageEnvVar(stageId);
    if (process.env[envName]?.trim()) {
      return {
        stageId,
        effectiveModel: process.env[envName]!.trim(),
        source: 'env-stage',
        envVar: envName,
      };
    }
    if (process.env.TRUECOURSE_MODEL?.trim()) {
      return {
        stageId,
        effectiveModel: process.env.TRUECOURSE_MODEL!.trim(),
        source: 'env-global',
        envVar: 'TRUECOURSE_MODEL',
      };
    }
    if (process.env.CLAUDE_CODE_MODEL?.trim()) {
      return {
        stageId,
        effectiveModel: process.env.CLAUDE_CODE_MODEL!.trim(),
        source: 'env-legacy',
        envVar: 'CLAUDE_CODE_MODEL',
      };
    }
    const cfgValue = cfg.llm?.stages?.[stageId];
    if (cfgValue && cfgValue.trim()) {
      return { stageId, effectiveModel: cfgValue.trim(), source: 'config' };
    }
    return { stageId, effectiveModel: STAGE_DEFAULTS[stageId], source: 'default' };
  });
  return { stages, fallbackModel: resolveFallbackModel(repoDir) };
}
