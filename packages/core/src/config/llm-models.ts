/**
 * Per-stage LLM model configuration.
 *
 * Every pipeline stage that shells out to the Claude CLI has a stable
 * stage ID (e.g. `spec.overlap`, `contract.extract`). Defaults are
 * baked into each runner; users override on a per-stage basis via
 * env vars or `.truecourse/config.json`.
 *
 * Resolution order (highest precedence first):
 *
 *   1. Per-stage env var: `TRUECOURSE_MODEL_<STAGE_ID_UPPER_WITH_UNDERSCORES>`
 *   2. Global env var:    `TRUECOURSE_MODEL`
 *   3. Per-stage value in config.json under `llm.stages.<stageId>`
 *   4. The API-mode model (`~/.truecourse/config.json#llm.api.model`)
 *   5. In-code default supplied by the caller
 *
 * Step 4 only applies when the RUN is in API mode, where the in-code defaults —
 * Claude CLI tier aliases like `opus` — mean nothing to a provider API: the user's
 * one configured model runs every stage they didn't explicitly override. A command
 * that overrode the transport for this run (`--llm-transport`) passes its effective
 * mode in, so an api-configured model never reaches a `claude` argv.
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
import {
  apiModeFallbackModel,
  apiModeModel,
  getConfiguredLlmMode,
  type LlmTransportMode,
} from './global-config.js';
import { getRepoConfigPath, resolveRepoDir } from './paths.js';

export type StageId =
  // --- spec scan (corpus path) ---
  | 'spec.relevance'
  | 'spec.areaTag'
  | 'spec.vocab'
  | 'spec.overlap'
  | 'spec.verifyOverlap'
  | 'contract.enumerate'
  | 'contract.reconcile'
  | 'contract.extract'
  | 'contract.repair'
  | 'contract.repairParse'
  | 'contract.gapJudge'
  // --- guard generate (scenario tests) ---
  // Only the two remaining ONE-SHOT stages are configurable here. The retired
  // per-stage ids (`guard.extract`, `guard.flows`, `guard.generate`,
  // `guard.retry`, `guard.fidelity`, `guard.triage`) became agent SESSIONS
  // (plan 04), which all run on the one configured session model (§3.4) —
  // there is no per-stage tier for them, so declaring the ids would advertise
  // overrides nothing reads.
  | 'guard.match'
  // The claim-diff gate: one call per edited section, deciding whether the edit
  // changed an obligation before the flows bound to it re-author.
  | 'guard.claimDiff'
  // --- guard run (the one LLM call a run can make) ---
  | 'guard.visualJudge'
  | 'guard.recipe'
  | 'guard.seed'
  // --- guard interfaces (the authored web surface) ---
  | 'guard.stateReconcile'
  | 'rules.violationGen';

/**
 * Default model per stage when the user hasn't configured an override.
 * Picked to balance cost vs. output quality on the stage's task
 * difficulty. Tunable here without touching the runners.
 */
export const STAGE_DEFAULTS: Record<StageId, string> = {
  'spec.relevance': 'haiku',
  // Area tagging is load-bearing (wrong tags → wrong generate inputs) and Haiku
  // under-tagged terse docs like ADRs; Sonnet is worth the cost here.
  'spec.areaTag': 'sonnet',
  'spec.vocab': 'haiku',
  'spec.overlap': 'haiku',
  // Detection is recall-biased Haiku; the verify pass is the precision judge that
  // prunes its false positives — a stricter comprehension call over one flagged
  // pair with full context, so sonnet (trivially A/B-able to opus via config).
  // The conflict judge runs on opus: it reads full docs per flag, and the flag
  // count keeps the spend small.
  'spec.verifyOverlap': 'opus',
  'contract.enumerate': 'sonnet',
  'contract.reconcile': 'sonnet',
  'contract.extract': 'opus',
  'contract.repair': 'opus',
  // Mechanical syntax fixing — cheap early attempts; the final attempt escalates
  // to the opus `contract.repair` model in the repair loop.
  'contract.repairParse': 'sonnet',
  // Auditing already-written gaps is a judgement call, not generation — sonnet.
  'contract.gapJudge': 'sonnet',
  // Realization matching picks, per flow milestone, which of a surface's interfaces
  // could realize it — structured SELECTION over digests, not authoring: a
  // judgement call, so sonnet — haiku under-reasons nuanced judgement (the
  // weakness that moved `spec.areaTag` off it), and a wrong plan births a
  // scenario that tests the wrong path.
  'guard.match': 'sonnet',
  // Same tier as matching: a judgement over one section's text against its
  // prior claims, made once per edit per repo. In API mode every stage runs on
  // the one configured model anyway.
  'guard.claimDiff': 'sonnet',
  // READING A SCREENSHOT of a failed web step — the only LLM call `guard run`
  // makes, and only ever about a failure. Vision comprehension of a real UI is the
  // top tier's work (a weaker model confidently mis-reads a rendered page, and the
  // whole value of this annotation is trustworthiness), and it fires so rarely —
  // once per failing web scenario, cached on the failure identity — that the spend
  // is negligible. Opus.
  'guard.visualJudge': 'opus',
  // Proposing a build/entry recipe is a modest structured task — sonnet.
  'guard.recipe': 'sonnet',
  // Drafting a seed script writes REAL code against the app's own ORM and
  // must satisfy the FK closure and every non-nullable column — the authoring tier's
  // task, not the recipe proposer's structured fill-in. Opus, and it is one call.
  'guard.seed': 'opus',
  // One call over the WHOLE state registry, deciding which sentences name the
  // same world. Top tier because a wrong merge conflates two worlds and every
  // task chaining through either inherits the conflation silently, while the
  // one-call-per-run shape keeps the spend negligible whatever the app's size.
  'guard.stateReconcile': 'opus',
  'rules.violationGen': 'opus',
};

export interface LlmConfigBlock {
  /**
   * Per-stage overrides keyed by stage ID. Parsing stays TOLERANT of retired
   * ids: a committed config.json still naming a session-era guard stage
   * (`guard.extract`, `guard.flows`, `guard.generate`, `guard.retry`,
   * `guard.fidelity`, `guard.triage`) loads fine — `readConfigSync` is a plain
   * JSON.parse and resolution only ever queries live ids, so a stale key is
   * inert, never a load failure.
   */
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
  // spec.areaTag → SPEC_AREA_TAG
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
 *
 * `mode` is the run's effective transport mode — pass it whenever a per-run
 * `--llm-transport` flag may have overridden the saved selection. It defaults to
 * the saved selection.
 */
export function resolveModel(
  stageId: StageId,
  defaultModel: string = STAGE_DEFAULTS[stageId],
  repoDir: string | null = resolveRepoDir(process.cwd()),
  mode: LlmTransportMode = getConfiguredLlmMode(),
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

  // 4. The one model API mode runs everything on
  const apiModel = apiModeModel(mode);
  if (apiModel) return apiModel;

  // 5. In-code default
  return defaultModel;
}

/**
 * Resolve the fallback model — what `--fallback-model` should pass
 * when the primary is overloaded. Returns null when no fallback is
 * configured (the CLI then fails loudly on overload).
 */
export function resolveFallbackModel(
  repoDir: string | null = resolveRepoDir(process.cwd()),
  mode: LlmTransportMode = getConfiguredLlmMode(),
): string | null {
  const env = process.env.TRUECOURSE_FALLBACK_MODEL;
  if (env && env.trim()) return env.trim();
  if (repoDir) {
    const cfg = readConfigSync(repoDir);
    if (cfg.llm?.fallbackModel) return cfg.llm.fallbackModel.trim();
  }
  return apiModeFallbackModel(mode);
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
  mode: LlmTransportMode = getConfiguredLlmMode(),
): string[] {
  const args: string[] = [];
  const model = resolveModel(stageId, defaultModel, repoDir, mode);
  if (model) {
    args.push('--model', model);
  }
  const fallback = resolveFallbackModel(repoDir, mode);
  if (fallback) {
    args.push('--fallback-model', fallback);
  }
  return args;
}

/**
 * Returns the effective model for every stage, plus where the value
 * came from (`env-stage` | `env-global` | `env-legacy` | `config` |
 * `api-config` | `default`). Used by `truecourse config llm --show`.
 */
export interface StageResolution {
  stageId: StageId;
  effectiveModel: string;
  source: 'env-stage' | 'env-global' | 'env-legacy' | 'config' | 'api-config' | 'default';
  envVar?: string;
}

export function describeStageResolutions(
  repoDir: string | null = resolveRepoDir(process.cwd()),
  mode: LlmTransportMode = getConfiguredLlmMode(),
): { stages: StageResolution[]; fallbackModel: string | null } {
  const cfg = repoDir ? readConfigSync(repoDir) : ({} as ConfigWithLlm);
  const apiModel = apiModeModel(mode);
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
    if (apiModel) {
      return { stageId, effectiveModel: apiModel, source: 'api-config' };
    }
    return { stageId, effectiveModel: STAGE_DEFAULTS[stageId], source: 'default' };
  });
  return { stages, fallbackModel: resolveFallbackModel(repoDir, mode) };
}
