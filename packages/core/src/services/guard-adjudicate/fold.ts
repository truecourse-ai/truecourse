/**
 * THE FOLD (plan 05 step 23) — strictly serial, and the ONLY place adjudication
 * writes anything. Two halves:
 *
 *  - the VALIDATION a fresh (or cached) verdict must pass — the structural
 *    invariants the schema alone cannot state: `bug` requires `code`; `bug` at
 *    medium-or-better confidence requires a `control` (and one the ENGINE
 *    actually ran — the stash check, fresh sessions only); a control that
 *    REFUTED forbids `bug`; `authoring-defect` / `seed-defect` require `fix`.
 *    A refused verdict converts to a `malformed` session failure before fold
 *    and cache — it must cost a re-run, never poison the cache.
 *
 *  - the PERSIST + ROUTING: the verdict lands on the run snapshot and the
 *    board (same pure patch, `withScenarioAdjudication`); `authoring-defect`
 *    taints the flow in the auto-resolutions ledger (source `adjudicate`,
 *    escalate-after-{@link DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER}); a
 *    high-confidence claim-level one auto-dismisses the claim through the
 *    existing auto tier; `bug` / `drift` stand red and feed the findings
 *    report; `infrastructure` / `seed-defect` are recorded and surfaced by
 *    `guard status`.
 */

import {
  DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER,
  autoResolutionKey,
  type GuardAdjudication,
  type GuardScenarioAdjudication,
} from '@truecourse/shared';
import {
  dismissGuardClaim,
  readGuardAutoResolutions,
  withScenarioAdjudication,
  writeGuardAutoResolutions,
} from '@truecourse/guard-runner';
import { readGuardLatest, readGuardRun, writeGuardLatest, writeGuardRun } from '../../lib/guard-store.js';
import type { AdjudicationSessionState } from './tools.js';
import type { AdjudicationItem } from './pre-pass.js';

/**
 * The structural invariants — `null` when the verdict stands. `state` is the
 * session's engine-side record (control stash): present for a FRESH outcome,
 * absent for a cached or deterministic one, whose control (if any) references
 * a session of the run that produced it — re-proving it here would demand a
 * stash no longer alive, so only the structure is checked.
 */
export function adjudicationRefusalReason(
  output: GuardAdjudication,
  state?: AdjudicationSessionState,
): string | null {
  if (output.class === 'bug' && !output.code) {
    return 'a `bug` verdict requires `code` (file + line) — the mechanism must be located in the source';
  }
  if (output.class === 'bug' && output.confidence !== 'low' && !output.control) {
    return 'a `bug` verdict at medium-or-better confidence requires a `control` — run `verify_bug` first';
  }
  if ((output.class === 'authoring-defect' || output.class === 'seed-defect') && !output.fix) {
    return `an \`${output.class}\` verdict requires \`fix\` (layer + description)`;
  }
  if (output.control && state) {
    const record = state.controls.get(output.control.transcriptRef);
    if (!record) {
      return `control.transcriptRef "${output.control.transcriptRef}" names no control the engine ran — cite the reference \`verify_bug\` gave you, verbatim`;
    }
    if (record.conclusion !== output.control.conclusion) {
      return `the engine's control concluded "${record.conclusion}", not "${output.control.conclusion}" — a verdict may not restate its control`;
    }
  }
  if (output.class === 'bug' && output.control?.conclusion === 'refutes') {
    return 'the control REFUTED the mechanism — a `bug` class cannot stand on it; downgrade the class';
  }
  return null;
}

/** What the routing did for one verdict — the run report's visible record. */
export interface AdjudicationRouting {
  /** The ledger taint, on `authoring-defect` — absent when the scenario
   *  belongs to no flow (nothing to taint). */
  tainted?: { key: string; count: number; escalated: boolean };
  /** The claim auto-dismissal, when the auto tier fired. */
  autoDismissed?: { doc: string; anchor: string; title: string };
}

export interface PersistAdjudicationResult {
  runUpdated: boolean;
  latestUpdated: boolean;
  routing: AdjudicationRouting;
}

/**
 * Persist one verdict and route its consequences. Serial by construction (the
 * pool's fold gate); every write is one read-patch-atomic-write.
 */
export async function persistAdjudication(opts: {
  repoRoot: string;
  item: AdjudicationItem;
  verdict: GuardScenarioAdjudication;
  now?: () => string;
}): Promise<PersistAdjudicationResult> {
  const { repoRoot, item, verdict } = opts;
  const now = opts.now ?? (() => new Date().toISOString());

  // 1. The run snapshot — the verdict rides the run whose actual it judged.
  let runUpdated = false;
  const snapshot = await readGuardRun(repoRoot, item.runId);
  if (snapshot) {
    const patched = withScenarioAdjudication(snapshot, item.scenarioId, verdict);
    if (patched) {
      await writeGuardRun(repoRoot, patched);
      runUpdated = true;
    }
  }

  // 2. The board — only while the row still shows THAT run's actual
  //    (`onlyIfRunId`): a row re-run since this adjudication started keeps its
  //    fresh, verdict-less state.
  let latestUpdated = false;
  const latest = await readGuardLatest(repoRoot);
  if (latest) {
    const patched = withScenarioAdjudication(latest, item.scenarioId, verdict, {
      onlyIfRunId: item.runId,
    });
    if (patched) {
      await writeGuardLatest(repoRoot, patched);
      latestUpdated = true;
    }
  }

  // 3. Routing.
  const routing: AdjudicationRouting = {};
  if (verdict.class === 'authoring-defect' && item.flowId) {
    const key = autoResolutionKey(item.flowId, item.surface);
    const ledger = readGuardAutoResolutions(repoRoot);
    const count = (ledger.entries[key]?.count ?? 0) + 1;
    const escalated = count > DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER;
    ledger.entries[key] = { count, source: 'adjudicate', updatedAt: now() };
    // The taint: the next generate bypasses the author cache and re-authors
    // fresh with the mechanism as correction evidence — set even past the
    // escalation threshold (a fresh re-author is harmless; the escalation
    // changes what the HUMAN is told, not what the cache serves).
    ledger.tainted[key] = {
      flowId: item.flowId,
      surface: item.surface,
      title: item.title,
      mismatch: verdict.mechanism,
      updatedAt: now(),
    };
    writeGuardAutoResolutions(repoRoot, ledger);
    routing.tainted = { key, count, escalated };

    // The auto tier: a HIGH-confidence scenario-layer defect whose failing
    // milestone resolves a claim identity dismisses that claim (idempotent by
    // identity), the mechanism as the recorded reason. Held back once the
    // escalation threshold is crossed — past it, nothing auto-resolves again.
    if (verdict.confidence === 'high' && verdict.fix?.layer === 'scenario' && !escalated) {
      const claim = claimIdentity(item);
      if (claim) {
        dismissGuardClaim(repoRoot, {
          ...claim,
          dismissedAt: now(),
          auto: true,
          reason: verdict.mechanism,
        });
        routing.autoDismissed = claim;
      }
    }
  }
  return { runUpdated, latestUpdated, routing };
}

/**
 * The claim a scenario-layer authoring defect is ABOUT — the dismissal
 * identity (doc + anchor + claim title). The committed diagnosis carries it
 * outright; failing that, the failing milestone of the flow names it. `null`
 * when neither does — a dismissal without an identity would key on nothing.
 * This is the structural reading of the plan's "mechanism names a claim-level
 * mistake": only a failure that RESOLVES to a claim can dismiss one.
 */
export function claimIdentity(
  item: AdjudicationItem,
): { doc: string; anchor: string; title: string } | null {
  if (item.diagnosis?.claim) {
    return { doc: item.diagnosis.doc, anchor: item.diagnosis.anchor, title: item.diagnosis.claim };
  }
  const order = item.row.failedMilestone;
  if (order !== undefined && item.flow) {
    const milestone = item.flow.milestones.find((m) => m.order === order);
    if (milestone) return { doc: milestone.doc, anchor: milestone.anchor, title: milestone.claimTitle };
  }
  return null;
}
