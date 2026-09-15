/**
 * The per-stage model TIER — what a one-shot stage asks the transport for.
 *
 * Every stage has a stable id (`spec.overlap`, `guard.match`) and an in-code
 * default tier picked for its task. A workspace on an API provider names ONE
 * model and its transport ignores the request, so these tiers are what an
 * operator-mode instance's `claude` login runs on, plus the environment
 * override an operator reaches for:
 *
 *   1. Per-stage env var: `TRUECOURSE_MODEL_<STAGE_ID_UPPER_WITH_UNDERSCORES>`
 *   2. Global env var:    `TRUECOURSE_MODEL`
 *   3. The in-code default
 *
 * Stage ids are deliberately stable strings — renaming a runner file does not
 * change the id, so an override outlives a refactor. Legacy `CLAUDE_CODE_MODEL`
 * is honored as an alias for `TRUECOURSE_MODEL`, with one deprecation line.
 */

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
  // `guard.retry`, `guard.fidelity`, `guard.triage`) became agent SESSIONS,
  // which all run on the one configured session model —
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

/** The model a stage asks for: its env override, else its in-code default. */
export function resolveModel(
  stageId: StageId,
  defaultModel: string = STAGE_DEFAULTS[stageId],
): string {
  const stageEnv = process.env[stageEnvVar(stageId)];
  if (stageEnv && stageEnv.trim()) return stageEnv.trim();

  maybeWarnLegacy();
  const globalEnv = process.env.TRUECOURSE_MODEL || process.env.CLAUDE_CODE_MODEL;
  if (globalEnv && globalEnv.trim()) return globalEnv.trim();

  return defaultModel;
}

/** What to retry with when the primary is overloaded, or null when unset. */
export function resolveFallbackModel(): string | null {
  const env = process.env.TRUECOURSE_FALLBACK_MODEL;
  return env && env.trim() ? env.trim() : null;
}
