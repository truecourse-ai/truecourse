/**
 * Rank-aware fragment merger.
 *
 * Each fragment carries a rank (derived from its source spec's entry in
 * `specs.yaml`). For each `(kind, identity)` group:
 *
 *   - The fragment with the **highest rank** wins outright (its
 *     `tcSource` becomes the merged artifact body).
 *   - Lower-rank fragments are recorded as `overridden` — useful when
 *     the writer stacks origin lines so the final `.tc` carries the full
 *     lineage of every artifact.
 *   - When two or more fragments share the *same* highest rank with
 *     different bodies, that's a **conflict** — emitted as a diagnostic;
 *     the merger picks the first encountered (deterministic order from
 *     the slicer) and flags it for human review.
 *
 * Phase 11 limitation (documented): layering is artifact-level, not
 * obligation-level. A higher-rank spec wholly replaces a lower-rank
 * artifact. Field-level layering (where a later spec only overrides one
 * `response.201` clause) is structurally tractable but not in this cut —
 * the writer's stacked origin lines still preserve the lineage so a
 * future obligation-level merger can reuse the same input shape.
 */

import type { Fragment } from './types.js';

export interface RankedFragment {
  fragment: Fragment;
  rank: number;
}

export interface MergedArtifact {
  kind: string;
  identity: string;
  /** Winning fragment (highest rank, first-seen on ties). */
  winning: Fragment;
  /** Rank of the winning fragment. */
  winningRank: number;
  /**
   * Lower-rank fragments that were overridden by `winning`. Stacked in
   * descending rank order. Their origins are surfaced in the writer's
   * output so the lineage is visible in the final `.tc`.
   */
  overridden: RankedFragment[];
  /** Other same-rank fragments with different bodies — flagged as conflicts. */
  sameRankConflicts: Fragment[];
}

export interface MergeDiagnostic {
  /** "Type:identity" key the diagnostic applies to. */
  artifactKey: string;
  /** Severity tier the CLI uses to colour the message. */
  severity: 'info' | 'warn' | 'error';
  /** Human-readable summary for the CLI. */
  message: string;
}

export interface MergeResult {
  artifacts: MergedArtifact[];
  diagnostics: MergeDiagnostic[];
}

export function mergeRankedFragments(input: RankedFragment[]): MergeResult {
  const groups = new Map<string, RankedFragment[]>();
  for (const rf of input) {
    const key = `${rf.fragment.kind}:${rf.fragment.identity}`;
    const existing = groups.get(key);
    if (existing) existing.push(rf);
    else groups.set(key, [rf]);
  }

  const artifacts: MergedArtifact[] = [];
  const diagnostics: MergeDiagnostic[] = [];

  for (const [key, group] of groups) {
    // Sort by rank descending; preserve insertion order on ties.
    const sorted = [...group].sort((a, b) => b.rank - a.rank);
    const top = sorted[0];

    // Same-rank conflicts: any other fragment at the top rank whose
    // tcSource differs from the winner.
    const sameRank = sorted.filter((rf) => rf.rank === top.rank);
    const sameRankConflicts = sameRank
      .slice(1)
      .filter((rf) => rf.fragment.tcSource !== top.fragment.tcSource)
      .map((rf) => rf.fragment);

    // Overridden: everything below the top rank, regardless of identity.
    const overridden = sorted.filter((rf) => rf.rank < top.rank);

    artifacts.push({
      kind: top.fragment.kind,
      identity: top.fragment.identity,
      winning: top.fragment,
      winningRank: top.rank,
      overridden,
      sameRankConflicts,
    });

    if (sameRankConflicts.length > 0) {
      diagnostics.push({
        artifactKey: key,
        severity: 'error',
        message:
          `Same-rank conflict on ${key} — ${sameRankConflicts.length + 1} fragments at rank ${top.rank} ` +
          `disagree (sources: ${sameRank.map((rf) => sourceLabel(rf.fragment)).join(', ')}). ` +
          `Resolve by editing one spec, raising one's rank, or marking it authoritative.`,
      });
    }
    if (overridden.length > 0) {
      diagnostics.push({
        artifactKey: key,
        severity: 'info',
        message:
          `${key}: rank ${top.rank} (${sourceLabel(top.fragment)}) overrides ` +
          `${overridden.length} lower-rank source${overridden.length === 1 ? '' : 's'} ` +
          `(${overridden.map((rf) => `${sourceLabel(rf.fragment)} @ rank ${rf.rank}`).join(', ')}).`,
      });
    }
  }
  return { artifacts, diagnostics };
}

/**
 * Phase 8 compatibility shim — accept un-ranked Fragments (rank=0 implicit)
 * so existing tests and callers keep working without forcing them into
 * the rank-aware shape.
 */
export function mergeFragments(fragments: Fragment[]): MergeResult {
  return mergeRankedFragments(fragments.map((fragment) => ({ fragment, rank: 0 })));
}

function sourceLabel(f: Fragment): string {
  return `${f.origin.source}#${f.origin.lines.join('-')}`;
}
