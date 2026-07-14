/**
 * Pure Code Quality gate decision. New violations the PR introduces vs the
 * baseline analysis fail the Check (blocking) or inform (advisory); no baseline
 * to diff against is neutral.
 */

import type { ViolationRecord } from '@truecourse/core/types/snapshot';

export type GateConclusion = 'success' | 'failure' | 'neutral';
export type GateSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const ORDER: GateSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

function meetsSeverity(s: GateSeverity, min: GateSeverity): boolean {
  return ORDER.indexOf(s) >= ORDER.indexOf(min);
}

export interface CodeQualityOptions {
  /** true → new violations at/above minSeverity fail the Check; false → neutral. */
  blocking: boolean;
  /** Min new-violation severity that fails. Default 'high' (noisier than drift). */
  minSeverity?: GateSeverity;
}

export interface CodeQualityDecision {
  conclusion: GateConclusion;
  /** New violations at/above the threshold (drives failure). */
  added: ViolationRecord[];
  /** New violations below the threshold (reported, doesn't fail). */
  belowThreshold: ViolationRecord[];
  /** Total NEW violations the PR introduces, all severities. */
  total: number;
  /** Set when neutral for a structural reason (no baseline analysis to diff). */
  neutralReason?: 'no-baseline';
}

/**
 * Pure Code Quality gate decision. `addedViolations` is the NEW violations the PR
 * introduces vs the baseline analysis (from analyzeCore's lifecycle), or `null`
 * when there's no baseline to diff against → neutral. Defaults to a `high`
 * threshold (architecture analysis is noisier than a line-level lint).
 */
export function decideCodeQuality(
  addedViolations: ViolationRecord[] | null | undefined,
  opts: CodeQualityOptions,
): CodeQualityDecision {
  if (addedViolations == null) {
    return { conclusion: 'neutral', added: [], belowThreshold: [], total: 0, neutralReason: 'no-baseline' };
  }
  const min = opts.minSeverity ?? 'high';
  const failing = addedViolations.filter((v) => meetsSeverity(v.severity as GateSeverity, min));
  const belowThreshold = addedViolations.filter((v) => !meetsSeverity(v.severity as GateSeverity, min));
  let conclusion: GateConclusion;
  if (failing.length === 0) conclusion = 'success';
  else conclusion = opts.blocking ? 'failure' : 'neutral';
  return { conclusion, added: failing, belowThreshold, total: addedViolations.length };
}
