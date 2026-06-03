/**
 * Pure drift-gate decision. Diffs the PR head's drifts against the base, and
 * decides the Check conclusion: new drift fails (blocking) or informs
 * (advisory); a head with no contracts is neutral.
 */

import { diffDrifts } from '@truecourse/core/types/verify-snapshot';
import type { GateDrift } from './store/types.js';

export type GateConclusion = 'success' | 'failure' | 'neutral';
export type GateSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface GateOptions {
  /** true → new drift fails the Check (a required check blocks merge); false → neutral. */
  blocking: boolean;
  /** Only drift at/above this severity fails. Default 'info' (any drift). */
  minSeverity?: GateSeverity;
  /**
   * Open spec conflicts in the head's scan that were auto-defaulted (>0 ⇒
   * neutral `unresolved-conflicts`: the spec is ambiguous, so we don't trust the
   * gate's verdict and ask a human to resolve before enforcing).
   */
  unresolvedConflicts?: number;
}

export interface GateDecision {
  conclusion: GateConclusion;
  /** New drift at/above the severity threshold (drives failure). */
  added: GateDrift[];
  /** Drift the PR resolved vs the base. */
  resolved: GateDrift[];
  /** New drift below the threshold (reported, doesn't fail). */
  belowThreshold: GateDrift[];
  /** Set when the conclusion is neutral for a structural reason. */
  neutralReason?: 'no-contracts' | 'no-baseline' | 'unresolved-conflicts';
  /** Count of unresolved spec conflicts (set when neutralReason is that). */
  unresolvedConflicts?: number;
}

const ORDER: GateSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

function meetsSeverity(s: GateSeverity, min: GateSeverity): boolean {
  return ORDER.indexOf(s) >= ORDER.indexOf(min);
}

export function decideGate(
  baseDrifts: GateDrift[] | null,
  headDrifts: GateDrift[] | null,
  opts: GateOptions,
): GateDecision {
  // The head's spec didn't fully resolve (conflicts were auto-defaulted). The
  // contracts encode a guess, so the gate's verdict isn't trustworthy — stay
  // neutral and let a human resolve the conflicts in the dashboard first. This
  // precedes the drift comparison: an ambiguous spec shouldn't pass OR fail.
  const conflicts = opts.unresolvedConflicts ?? 0;
  if (conflicts > 0) {
    return {
      conclusion: 'neutral',
      added: [],
      resolved: [],
      belowThreshold: [],
      neutralReason: 'unresolved-conflicts',
      unresolvedConflicts: conflicts,
    };
  }
  // A head with no committed contracts can't be gated.
  if (headDrifts === null) {
    return {
      conclusion: 'neutral',
      added: [],
      resolved: [],
      belowThreshold: [],
      neutralReason: 'no-contracts',
    };
  }
  // No base contracts to diff against (e.g. the PR is bootstrapping contracts
  // before any baseline exists) — don't fail; just inform.
  if (baseDrifts === null) {
    return {
      conclusion: 'neutral',
      added: [],
      resolved: [],
      belowThreshold: [],
      neutralReason: 'no-baseline',
    };
  }

  const { added, resolved } = diffDrifts(baseDrifts, headDrifts);
  const min = opts.minSeverity ?? 'info';
  const failing = added.filter((d) => meetsSeverity(d.severity, min));
  const belowThreshold = added.filter((d) => !meetsSeverity(d.severity, min));

  let conclusion: GateConclusion;
  if (failing.length === 0) conclusion = 'success';
  else conclusion = opts.blocking ? 'failure' : 'neutral';

  return { conclusion, added: failing, resolved, belowThreshold };
}
