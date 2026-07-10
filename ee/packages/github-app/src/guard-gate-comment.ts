/**
 * Rendering for the guard-gate Check output, plus the deployment kill switch.
 * An internal 'error' conclusion renders as an error-styled FAILURE (a broken
 * gate blocks the merge — decision 1); stale-scenario annotations are built by
 * the pipeline (it has the checked-out docs) and capped here at GitHub's
 * 50-per-request limit.
 */

import type { GuardScenarioResult } from '@truecourse/shared';
import { GATE_CHECK_NAME } from './gate-comment.js';
import type { CheckAnnotation } from './octokit.js';
import type { GuardGateDecision } from './guard-gate.js';

/** The guard gate completes the same Check as the drift gate — one verdict per PR. */
export const GUARD_GATE_CHECK_NAME = GATE_CHECK_NAME;

/** Inline warning on a stale/orphaned scenario's bound doc section — a
 *  `CheckAnnotation` pinned to warning level (stale bindings never fail),
 *  with the title always present. */
export type GuardStaleAnnotation = CheckAnnotation & {
  annotation_level: 'warning';
  title: string;
};

export interface GuardGateCheckOutput {
  title: string;
  summary: string;
  annotations?: GuardStaleAnnotation[];
}

/** GitHub rejects more than 50 annotations per Check request. */
export const GUARD_GATE_MAX_ANNOTATIONS = 50;

export function capGuardAnnotations(annotations: GuardStaleAnnotation[]): GuardStaleAnnotation[] {
  return annotations.length > GUARD_GATE_MAX_ANNOTATIONS
    ? annotations.slice(0, GUARD_GATE_MAX_ANNOTATIONS)
    : annotations;
}

const ERROR_TITLE: Record<NonNullable<GuardGateDecision['errorReason']>, string> = {
  'build-failed': 'Gate error — build failed (no verdict)',
  'build-timed-out': 'Gate error — build timed out (no verdict)',
  'entry-preflight': 'Gate error — built entry failed to start (no verdict)',
  'run-timed-out': 'Gate error — run timed out (no verdict)',
  aborted: 'Gate error — run aborted (no verdict)',
  infra: 'Gate error — gate infrastructure failed (no verdict)',
};

function scenarioLine(s: GuardScenarioResult): string {
  const detail = s.failure ? ` — step ${s.failure.step} failed` : '';
  return `- **${s.outcome}** ${s.title} — \`${s.binds.doc}#${s.binds.section}\`${detail}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function guardGateCheckOutput(decision: GuardGateDecision): GuardGateCheckOutput {
  if (decision.conclusion === 'error') {
    return {
      title: ERROR_TITLE[decision.errorReason ?? 'infra'],
      summary:
        'The guard gate produced no verdict for this PR. This Check fails so a ' +
        'broken gate never silently passes — fix the cause and push again to re-run.',
    };
  }
  if (decision.neutralReason === 'no-scenarios') {
    return {
      title: 'No guard scenarios to run',
      summary:
        'This repository has no committed guard scenarios (or no runnable recipe), ' +
        'so the guard gate has nothing to check.',
    };
  }
  if (decision.neutralReason === 'no-baseline') {
    return {
      title: 'Baseline not established',
      summary:
        'No base guard run to compare against yet. The baseline is set when changes ' +
        'merge to the default branch; this PR is not gated.',
    };
  }
  const { diff } = decision;
  if (diff.newlyFailing.length === 0) {
    const notes = [
      diff.resolved.length ? `${diff.resolved.length} resolved by this PR. 🎉` : null,
      // "Pre-existing" = failing without a base pass to blame the PR for — also
      // failing on the base, or without any base counterpart at all (not gated).
      diff.preExisting.length
        ? `${count(diff.preExisting.length, 'pre-existing failure')} not attributable to this PR (not gated).`
        : null,
      diff.stale.length ? `${count(diff.stale.length, 'stale binding')} — see annotations.` : null,
      diff.excluded.length ? `${count(diff.excluded.length, 'dismissed scenario')} excluded.` : null,
    ].filter(Boolean);
    return {
      title: 'No newly failing guard scenarios',
      summary: `No guard scenarios newly broken by this PR.${notes.length ? ` ${notes.join(' ')}` : ''}`,
    };
  }
  const list = diff.newlyFailing.map((s) => scenarioLine(s)).join('\n');
  const advisory =
    decision.conclusion === 'neutral' ? '\n\n_Advisory mode: this does not block the merge._' : '';
  return {
    title: `${count(diff.newlyFailing.length, 'newly failing guard scenario')}`,
    summary: `${list}${advisory}`,
  };
}

/** Global deployment kill switch: truthy → neutral Check, no clone, no run. */
export const GUARD_GATE_KILL_SWITCH_ENV = 'TRUECOURSE_GUARD_GATE_DISABLED';

export function guardGateDisabled(): boolean {
  const v = process.env[GUARD_GATE_KILL_SWITCH_ENV];
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

export function guardGateDisabledOutput(): { title: string; summary: string } {
  return {
    title: 'Guard gate disabled',
    summary:
      `The guard gate is disabled on this deployment (${GUARD_GATE_KILL_SWITCH_ENV} is set); ` +
      'no scenarios were run and this PR is not gated.',
  };
}
