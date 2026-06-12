/**
 * Claim-coverage gate.
 *
 * The extraction LLM is told (in `prompt.ts`) to never silently drop a
 * claim, but nothing enforced it — so claims the model judged "redundant"
 * or "implementation-only" vanished without a trace. This module is the
 * deterministic backstop: after merge + repair, every claim that fed a
 * slice MUST be represented by at least one contract fragment. Any claim
 * that isn't is surfaced (and, in `repair.ts`, re-prompted) so the
 * decision to encode-or-skip it is conscious, never silent.
 *
 * Matching is intentionally biased toward flagging: a claim counts as
 * covered only on a strong signal (an artifact whose `origin` cites the
 * claim's source file and overlaps its line, or whose identity is the
 * claim's subject). A false "uncovered" only costs one cheap re-prompt; a
 * false "covered" would let a real requirement disappear — the exact bug
 * this gate exists to prevent. So we never use loose substring matching.
 */

import path from 'node:path';
import type { MergedArtifact } from './merger.js';
import type { Fragment, SpecSlice, SpecSliceClaim } from './types.js';

export interface UncoveredClaim {
  claim: SpecSliceClaim;
  /** The slice the claim was rendered into — carries the text + line range
   *  a re-prompt needs to re-examine the claim. */
  slice: SpecSlice;
}

/**
 * Return every claim across `slices` that no artifact covers. Slices
 * without a `claims` array (legacy/markdown producers, test fixtures)
 * contribute nothing.
 */
export function detectUncoveredClaims(
  artifacts: MergedArtifact[],
  slices: SpecSlice[],
): UncoveredClaim[] {
  const fragments = artifacts.map((a) => a.winning);
  const out: UncoveredClaim[] = [];
  for (const slice of slices) {
    for (const claim of slice.claims ?? []) {
      const covered = fragments.some((f) => fragmentCoversClaim(f, claim));
      if (!covered) out.push({ claim, slice });
    }
  }
  return out;
}

/**
 * True when a fragment plausibly encodes a claim. Two strong signals:
 *
 *  1. **Origin overlap** — the fragment's `origin` names the same source
 *     file (by basename, case-insensitively) and its line range contains
 *     one of the claim's source lines. The extraction prompt instructs the
 *     LLM to cite the claim's own source lines in `origin`, so this is the
 *     primary, reliable signal.
 *  2. **Identity match** — the fragment's identity is the claim's subject
 *     (normalized). Covers kinds where the LLM uses the subject verbatim as
 *     the artifact id.
 */
export function fragmentCoversClaim(fragment: Fragment, claim: SpecSliceClaim): boolean {
  if (originOverlapsClaim(fragment.origin, claim)) return true;
  if (normalizeId(fragment.identity) === normalizeId(claim.subject)) return true;
  return false;
}

function originOverlapsClaim(origin: Fragment['origin'], claim: SpecSliceClaim): boolean {
  const [start, end] = origin.lines;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const originFile = basename(origin.source);
  // The claim's own (file, line) plus any auto-merged additional sources.
  const sources = [
    { file: claim.file, line: claim.line },
    ...(claim.additionalSources ?? []),
  ];
  for (const src of sources) {
    if (basename(src.file) !== originFile) continue;
    if (src.line >= lo && src.line <= hi) return true;
  }
  return false;
}

function basename(file: string): string {
  return path.basename(file).toLowerCase();
}

/** Collapse to lowercase alphanumerics so "POST /api/x" ≈ "post-api-x". */
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Safety-net synthesis
// ---------------------------------------------------------------------------

/**
 * Last-resort fragment for a claim that the coverage re-prompt could not
 * resolve (e.g. the transport errored). Encodes the claim as an
 * `unenforceable-obligation` so the requirement survives into the contract
 * set — and thus into any spec reconstructed from it — instead of being
 * silently dropped. The repair pass only falls back to this on hard
 * failure; a healthy run produces a structural contract or a model-authored
 * obligation instead.
 *
 * The obligation's `category` is the claim's own topic, carried through
 * verbatim — there is no invented topic→category table to drift out of sync
 * with the spec vocabulary.
 *
 * `existingIds` lets the caller guarantee a unique identity.
 */
export function synthesizeObligationFragment(
  claim: SpecSliceClaim,
  existingIds: Set<string> = new Set(),
): Fragment {
  const identity = uniqueIdentity(slugify(claim.subject) || 'claim', existingIds);
  const category = claim.topic || 'unknown';
  const source = formatOriginSource(claim.file);
  const section = claim.topic || 'spec';
  const specText = tcEscape(claim.subject);
  const tcSource = [
    `unenforceable-obligation ${identity} {`,
    `  origin ${source} "${tcEscape(section)}" ${claim.line}..${claim.line}`,
    `  spec-text "${specText}"`,
    `  category ${category}`,
    `  rationale "Coverage fallback: this claim produced no contract during extraction or repair; preserved so the requirement is not silently dropped. Review and encode it structurally if it is verifiable against code."`,
    `}`,
  ].join('\n');

  return {
    kind: 'UnenforceableObligation',
    identity,
    tcSource,
    origin: { source: claim.file, section, lines: [claim.line, claim.line] },
    obligationKeys: [],
    reason: 'coverage-fallback',
  };
}

function uniqueIdentity(base: string, existing: Set<string>): string {
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  const id = `${base}-${n}`;
  existing.add(id);
  return id;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^-+|-+$/g, '');
}

/** Bare filename is fine; a path with a slash must be quoted for the parser. */
function formatOriginSource(file: string): string {
  return file.includes('/') ? `"${tcEscape(file)}"` : file;
}

function tcEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
}
