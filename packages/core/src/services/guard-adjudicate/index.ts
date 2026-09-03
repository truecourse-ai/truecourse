/**
 * Run adjudication (plan 05) — the engine halves behind
 * `commands/guard-adjudicate.ts`: the deterministic pre-pass, the
 * `guard-adjudicate.failure` session (tools, briefing, cache key), the
 * `guard-adjudicate.control` child, the serial fold + routing, and the
 * findings report renderer.
 */

export {
  actualMatchesPrediction,
  deterministicVerdict,
  itemSurface,
  type AdjudicationItem,
} from './pre-pass.js';
export {
  ADJUDICATE_BUDGET,
  ADJUDICATE_CACHE_NAME,
  ADJUDICATE_PROMPT_FINGERPRINT,
  ADJUDICATE_SESSION_KIND,
  ADJUDICATE_SYSTEM_PROMPT,
  adjudicationBriefing,
  adjudicationCacheKey,
  adjudicationSessionDef,
  adjudicationWorkItem,
  scenarioBehaviorHash,
  sectionTextsForItem,
} from './session.js';
export {
  buildAdjudicationTools,
  newSessionState,
  RERUN_MAX,
  type AdjudicationSessionState,
  type ControlRecord,
} from './tools.js';
export {
  CONTROL_BUDGET,
  CONTROL_MAX_EXECUTIONS,
  CONTROL_SESSION_KIND,
  CONTROL_SYSTEM_PROMPT,
  controlBriefing,
  controlSessionDef,
  GuardControlOutcomeSchema,
  type GuardControlOutcome,
} from './control.js';
export {
  adjudicationRefusalReason,
  claimIdentity,
  persistAdjudication,
  type AdjudicationRouting,
  type PersistAdjudicationResult,
} from './fold.js';
export { buildEvidenceDigest, readInvocation } from './evidence.js';
export { condenseResult, executeOneScenario, type AdjudicationExecution } from './execute.js';
export {
  parseFindingNumbering,
  renderGuardFindingsReport,
  writeGuardFindingsReport,
  type RenderedFindingsReport,
} from './findings-report.js';
