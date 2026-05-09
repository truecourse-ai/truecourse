/**
 * Claim merger. Groups extracted claims by `(topic, subject)`, then
 * for each group:
 *
 *   - 1 claim                                 → singleton, emit as-is.
 *   - 2+ claims with identical content+status → auto-merge, provenance
 *                                                 from all sources stitched together.
 *   - 2+ claims with any difference           → emit as a `Conflict`
 *                                                 (Q2: any difference = user confirms).
 *
 * Decisions (the user's previous resolutions) are honored:
 *
 *   - If a conflict's id matches a decision in `decisions.json`, it
 *     becomes a "decided conflict" — not surfaced for review.
 *   - When the decision is `pick`, we resolve to the picked candidate's
 *     claim (with merged provenance).
 *   - When the decision is `custom`, we surface the chosen content but
 *     leave assembly of the final Claim to the materializer (it has to
 *     fabricate a synthetic provenance for user-supplied content).
 *
 * Per Q13, decisions persist across re-scans. The merger never
 * second-guesses an existing decision: as long as the candidate
 * fingerprint is unchanged, the decision applies.
 */

import { createHash } from 'node:crypto';
import type {
  Claim,
  Conflict,
  ConflictCandidate,
  Decision,
  DecisionsFile,
} from './types.js';

export interface MergeResult {
  /**
   * Claims that need no user input — singletons and groups whose
   * sources agreed. Provenance of multi-source agreements is stitched
   * (all sources retained).
   */
  resolvedClaims: Claim[];
  /**
   * Conflicts the user has previously decided. The materializer reads
   * these to produce final canonical content; the dashboard shows them
   * as "resolved" history but doesn't re-prompt.
   */
  decidedConflicts: DecidedConflict[];
  /**
   * Conflicts awaiting user input. These appear in the dashboard
   * resolve view.
   */
  openConflicts: Conflict[];
}

export interface DecidedConflict {
  conflict: Conflict;
  decision: Decision;
  /** Set when decision.kind === 'pick'. Absent when 'custom'. */
  resolvedClaim?: Claim;
}

/**
 * Run the merge.
 *
 * Order of `claims` in the output groups (and thus in conflict
 * candidates) is sorted by `lastTouched` ASC (oldest first). This
 * keeps conflict ids stable across runs even when extraction
 * concurrency reorders the input.
 */
export function mergeClaims(
  claims: Claim[],
  decisions: DecisionsFile = { version: 1, decisions: [] },
): MergeResult {
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    const key = `${c.topic}::${c.subject}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const decisionsById = new Map<string, Decision>(
    decisions.decisions.map((d) => [d.conflictId, d]),
  );

  const resolvedClaims: Claim[] = [];
  const decidedConflicts: DecidedConflict[] = [];
  const openConflicts: Conflict[] = [];

  // Sort group keys for deterministic output ordering.
  const sortedKeys = [...groups.keys()].sort();
  for (const key of sortedKeys) {
    const list = sortClaims(groups.get(key)!);
    if (list.length === 1) {
      resolvedClaims.push(list[0]);
      continue;
    }

    if (allIdentical(list)) {
      resolvedClaims.push(mergeIdentical(list));
      continue;
    }

    const conflict = buildConflict(list);
    const decision = decisionsById.get(conflict.id);
    if (decision) {
      decidedConflicts.push(buildDecided(conflict, decision));
    } else {
      openConflicts.push(conflict);
    }
  }

  return { resolvedClaims, decidedConflicts, openConflicts };
}

// ---------------------------------------------------------------------------
// Sort, identity, and merge helpers
// ---------------------------------------------------------------------------

function sortClaims(list: Claim[]): Claim[] {
  return [...list].sort((a, b) => {
    if (a.metadata.lastTouched !== b.metadata.lastTouched) {
      return a.metadata.lastTouched < b.metadata.lastTouched ? -1 : 1;
    }
    // Tie-break by id so order is stable.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function allIdentical(list: Claim[]): boolean {
  const first = fingerprint(list[0]);
  for (let i = 1; i < list.length; i++) {
    if (fingerprint(list[i]) !== first) return false;
  }
  return true;
}

/**
 * Fingerprint the parts of a claim that determine "are these two
 * claims saying the same thing": content + status. Provenance and
 * docKind don't matter for the comparison — they're WHO said it,
 * not WHAT was said.
 */
function fingerprint(claim: Claim): string {
  const payload = {
    content: claim.content,
    status: claim.metadata.status ?? null,
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Stable JSON stringify: keys sorted at every level. Two claims with
 * the same shape but different key insertion order fingerprint
 * identically. Without this, LLM output reordering would create
 * spurious conflicts.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function mergeIdentical(list: Claim[]): Claim {
  // Keep the first (oldest) claim's id and content; surface every
  // contributing source structurally so the materializer can list
  // them in module manifests, and stitch the human-readable quote
  // for dashboard display.
  const head = list[0];
  if (list.length === 1) return head;
  const additionalSources = list.slice(1).map((c) => ({
    file: c.provenance.file,
    line: c.provenance.line,
    quote: c.provenance.quote,
  }));
  return {
    ...head,
    provenance: {
      file: head.provenance.file,
      line: head.provenance.line,
      quote: list
        .map((c) => `[${c.provenance.file}:${c.provenance.line}] ${c.provenance.quote}`)
        .join('\n---\n'),
      additionalSources,
    },
  };
}

// ---------------------------------------------------------------------------
// Conflict construction
// ---------------------------------------------------------------------------

function buildConflict(list: Claim[]): Conflict {
  const candidates: ConflictCandidate[] = list.map((claim, index) => ({
    index,
    weight: weightOf(index, list.length),
    claim,
  }));

  // Q10 default-pick rule: newest doc wins. Since `list` is sorted
  // by lastTouched ASC, the last index is the newest.
  const defaultPick = candidates.length - 1;

  const id = conflictId(list);

  return {
    id,
    topic: list[0].topic,
    subject: list[0].subject,
    candidates,
    defaultPick,
  };
}

/**
 * Conflict id is content-addressed by the candidate set. Includes
 * sorted claim ids so the id is stable across runs as long as the
 * same set of claims (by id) is in conflict — added/removed
 * candidates produce a new id, which (per Q13) lets a re-scan
 * surface the changed-set as a new conflict instead of silently
 * applying a stale resolution.
 */
function conflictId(list: Claim[]): string {
  const ids = list.map((c) => c.id).sort();
  return createHash('sha256')
    .update(`${list[0].topic}::${list[0].subject}::${ids.join(',')}`)
    .digest('hex');
}

/**
 * Public helper for downstream consumers (decision recording in
 * particular) so they can compute the candidate fingerprint at the
 * time of resolution.
 */
export function candidateFingerprint(conflict: Conflict): string {
  const ids = conflict.candidates.map((c) => c.claim.id).sort();
  return createHash('sha256').update(ids.join(',')).digest('hex');
}

function weightOf(index: number, total: number): ConflictCandidate['weight'] {
  if (total === 1) return 'newest';
  if (index === 0) return 'oldest';
  if (index === total - 1) return 'newest';
  if (index < total / 2) return 'older';
  return 'newer';
}

// ---------------------------------------------------------------------------
// Decision application
// ---------------------------------------------------------------------------

function buildDecided(conflict: Conflict, decision: Decision): DecidedConflict {
  if (decision.resolution.kind === 'pick') {
    const idx = decision.resolution.candidateIndex;
    const candidate = conflict.candidates[idx];
    if (!candidate) {
      // Decision references an index that doesn't exist anymore —
      // shouldn't happen because conflict ids change when the
      // candidate set changes (Q13). Surface as un-decided so the
      // user sees the issue.
      return { conflict, decision };
    }
    return { conflict, decision, resolvedClaim: candidate.claim };
  }
  // 'custom' — leave resolvedClaim unset; materializer assembles it.
  return { conflict, decision };
}
