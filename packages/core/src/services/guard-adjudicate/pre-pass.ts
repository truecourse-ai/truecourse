/**
 * THE DETERMINISTIC PRE-PASS (plan 05 step 21) — zero sessions for the common
 * case. A guard run's failure often explains itself off facts the stores
 * already hold, and a session spent re-deriving one of them is a session
 * wasted; each rule below produces the SAME `GuardAdjudication` shape a
 * session would, with the machine as the author:
 *
 *  1. `expected-red` — the scenario's committed diagnosis carries the flow
 *     worker's own adjudication (`expectedRed`, plan 04 §17). When the failing
 *     step is the declared one AND the recorded actual matches the worker's
 *     `predictedActual` (the same normalized-containment rule the worker's
 *     acceptance gate used), the red is exactly the disagreement the corpus
 *     committed on purpose. Verdict: `expected-red`, confidence high,
 *     mechanism = the worker's brief.
 *  2. `seed-defect` — the runner's own setup-defect sentinels
 *     (`isSetupDefectResult`): a `setup.files` path or a declared setup
 *     capability failed before any step ran. A state the runner DETECTED, not
 *     an opinion a model holds.
 *  3. `infrastructure` — the `unservedRoute` annotation: the request 404ed on
 *     a path the route manifest attributes to a server the recipe never
 *     declares. Nothing about the repo is in dispute.
 *
 * Everything else is a surprise, and surprises are what the sessions are for.
 */

import {
  guardScenarioDrivers,
  type GuardAdjudication,
  type GuardDriverId,
  type GuardExpectedRed,
  type GuardFlow,
  type GuardScenario,
  type GuardScenarioAdjudication,
  type GuardScenarioDiagnosis,
  type GuardScenarioResult,
} from '@truecourse/shared';
import { isSetupDefectResult } from '@truecourse/guard-runner';

/**
 * One failure the adjudication run works on — a board `fail` / `error` row
 * joined with everything the stores know about it. Assembled once by the
 * command adapter; the pre-pass, the cache key, the briefing and the fold all
 * read THIS, so they can never join the stores differently.
 */
export interface AdjudicationItem {
  scenarioId: string;
  title: string;
  outcome: 'fail' | 'error';
  /** The run whose recorded actual this verdict judges — the row's EFFECTIVE
   *  run (`guardResultRunId`), which is also where its evidence lives. */
  runId: string;
  /** The board row verbatim — annotations (`unservedRoute`, `failure.visual`,
   *  `failedMilestone`) ride here. */
  row: GuardScenarioResult;
  /** 1-based failing step (1 when the row carries no failure detail). */
  step: number;
  expected: string;
  actual: string;
  /** The surface the scenario runs on — its primary driver. */
  surface: GuardDriverId;
  flowId?: string;
  /** Repo-relative evidence dir (`.truecourse/guard/evidence/<runId>/<scenario>`),
   *  absent when the run never wrote a bundle. */
  evidenceDir?: string;
  /** The committed scenario — absent only when the corpus no longer holds it
   *  (such an item cannot be adjudicated and fails in the pre-flight). */
  scenario?: GuardScenario;
  /** Repo-relative path of the committed `.yaml`. */
  scenarioFile?: string;
  /** The committed `.yaml`'s raw text — the briefing quotes it verbatim. */
  scenarioYaml?: string;
  /** The flow the scenario realizes, from `scenarios/flows.json`. */
  flow?: GuardFlow;
  /** The manifest diagnosis the failing test committed with, when one exists. */
  diagnosis?: GuardScenarioDiagnosis;
  /** The flow worker's declared red for this scenario, off the diagnosis. */
  expectedRed?: GuardExpectedRed;
  /** A verdict this row ALREADY carries — present only when the caller scoped
   *  the row explicitly (re-adjudication); briefed as the prior verdict. */
  prior?: GuardScenarioAdjudication;
}

/**
 * Whether a recorded actual matches a declared prediction: whitespace-normalized
 * equality or containment. Containment, deliberately — the worker copied
 * `predictedActual` off its own run, and the runner's display truncation must
 * not fail an honest prediction. Mirrors `actualMatchesPrediction` in
 * `guard-generator/src/generate.ts` (private there; the rule must not drift).
 */
export function actualMatchesPrediction(actual: string, predicted: string): boolean {
  const norm = (t: string): string => t.replace(/\s+/g, ' ').trim();
  const na = norm(actual);
  const np = norm(predicted);
  return na === np || na.includes(np);
}

/** The scenario's primary driver — what the (flow, surface) identity keys on. */
export function itemSurface(scenario: GuardScenario | undefined): GuardDriverId {
  if (!scenario) return 'cli';
  return guardScenarioDrivers(scenario)[0] ?? 'cli';
}

/**
 * The pre-pass verdict for one failure, or `null` when only a session can
 * answer. Pure and free — the estimate runs it too, so the confirm prompt and
 * the run can never disagree about which failures reach sessions.
 */
export function deterministicVerdict(item: AdjudicationItem): GuardAdjudication | null {
  // 1. The declared red, reproduced: the committed corpus already carries the
  //    verdict, so restating it costs nothing and settles the row.
  if (
    item.expectedRed &&
    item.expectedRed.step === item.step &&
    actualMatchesPrediction(item.actual, item.expectedRed.predictedActual)
  ) {
    return {
      class: 'expected-red',
      mechanism: item.expectedRed.brief,
      evidence: [
        `declared ${item.expectedRed.verdict} at step ${item.expectedRed.step}: predicted "${item.expectedRed.predictedActual}"`,
        `observed actual: "${item.actual}"`,
      ],
      confidence: 'high',
      findings: [],
    };
  }

  // 2. The runner's own setup-defect sentinels: the scenario's setup
  //    declaration failed before the behavior under test was reached.
  if (isSetupDefectResult(item.row)) {
    return {
      class: 'seed-defect',
      mechanism: `the scenario's setup declaration failed before any step ran: ${item.actual}`,
      evidence: [`expected: ${item.expected}`, `actual: ${item.actual}`],
      fix: { layer: 'scenario', description: item.actual },
      confidence: 'high',
      findings: [],
    };
  }

  // 3. The unserved-route annotation: the recipe declares no server for the
  //    service that owns the path — a configuration gap, never a code verdict.
  if (item.row.unservedRoute === true) {
    return {
      class: 'infrastructure',
      mechanism:
        `the request hit a route the recipe declares no server for (unserved route) — ` +
        `the fix is one recipe edit, not a code change: ${item.actual}`,
      evidence: [`expected: ${item.expected}`, `actual: ${item.actual}`],
      confidence: 'high',
      findings: [],
    };
  }

  return null;
}
