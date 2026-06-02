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
 * Layering granularity is artifact-level: a higher-rank spec wholly
 * replaces a lower-rank artifact body. Field-level overrides (e.g. a
 * later spec that only redefines one `response.201` clause) are not
 * supported — the writer stacks `origin` lines so the lineage stays
 * visible regardless.
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
    // Sort by rank descending. Within ties, break by structural
    // specificity (see specificityScore) so an authoritative narrower
    // fragment beats a fallback broader one when both came in at the
    // same rank. Insertion order is the final tiebreaker.
    const sorted = [...group]
      .map((rf, originalIndex) => ({ rf, originalIndex }))
      .sort((a, b) => {
        if (b.rf.rank !== a.rf.rank) return b.rf.rank - a.rf.rank;
        const scoreDiff =
          specificityScore(b.rf.fragment) - specificityScore(a.rf.fragment);
        if (scoreDiff !== 0) return scoreDiff;
        return a.originalIndex - b.originalIndex;
      })
      .map((entry) => entry.rf);
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
 * Convenience wrapper for callers that don't track ranks — every
 * fragment is treated as rank 0, so same-(kind, identity) duplicates
 * with different bodies surface as same-rank conflicts.
 */
export function mergeFragments(fragments: Fragment[]): MergeResult {
  return mergeRankedFragments(fragments.map((fragment) => ({ fragment, rank: 0 })));
}

function sourceLabel(f: Fragment): string {
  return `${f.origin.source}#${f.origin.lines.join('-')}`;
}

/**
 * Rough structural-specificity score for tiebreaking when two
 * fragments share `(kind, identity)` and rank. Higher = more specific.
 *
 * The signals are deliberately conservative — we want to prefer
 * fragments that the verifier can actually act on (enumerated
 * operations, concrete responses, explicit error codes) over fragments
 * that fall back to broad wildcards. Real-world example: the same
 * `auth.role.admin` requirement extracted from two slices, one with
 * `selector operations [Operation:"POST /api/customers"]` (precise),
 * the other with `selector path-glob "/api/**"` (broad fallback). The
 * verifier matches the broad one against every operation in the
 * corpus, cascading false-positive drifts; the precise one fires only
 * on the actually-gated route. Specificity wins.
 *
 * This is a fallback, not the primary signal — rank still dominates.
 */
function specificityScore(f: Fragment): number {
  const src = f.tcSource;
  let score = 0;
  // Enumerated operation selectors are the most specific form a
  // verifier can dispatch on.
  if (/\bselector\s+operations\s*\[/.test(src)) score += 10;
  // Exact-path selectors are next-most specific.
  if (/\bselector\s+path-exact\s+"/.test(src)) score += 6;
  // Narrow path globs beat universal ones.
  if (/\bselector\s+path-glob\s+"/.test(src)) {
    score += /\bselector\s+path-glob\s+"\/api\/(\*\*|\*)"/.test(src) ? 1 : 4;
  }
  // Specific HTTP status codes are more precise than status classes.
  for (const m of src.matchAll(/\bresponse\s+(\d{3})\b/g)) score += 2;
  for (const m of src.matchAll(/\bresponse\s+\dxx\b/g)) score += 1;
  // Forbids clauses encode anti-spec — the verifier needs them to fire.
  for (const m of src.matchAll(/\bforbid\b/g)) score += 1;
  // `except` blocks narrow auth/authz selectors — concrete refinement.
  if (/\bexcept\s*\{/.test(src)) score += 2;
  // Cross-references signal connected, well-typed contracts.
  for (const m of src.matchAll(/[A-Z][a-zA-Z]+:[A-Za-z0-9.\-]+/g)) score += 1;
  return score;
}
