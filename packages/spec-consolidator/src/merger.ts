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
 * Empty-content claims are dropped from a group when other claims in
 * the same group carry actual data — they're typically the LLM
 * finding a relevant section without extracting anything quotable.
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
  DocKind,
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
    const list = sortClaims(dropEmptyContentClaims(groups.get(key)!));
    if (list.length === 1) {
      resolvedClaims.push(list[0]);
      continue;
    }

    if (allIdentical(list)) {
      resolvedClaims.push(mergeIdentical(list));
      continue;
    }

    // Strict-subset merge across the group. If every pair's contents
    // relate by a clean subset/superset structure with all overlapping
    // leaves equal, fold them into a single richer claim. Catches the
    // "B is a superset of A" pattern (e.g. an ADR's bare envelope vs a
    // PRD's same envelope + extra optional fields + a codes catalog)
    // without over-merging genuinely alternative claims (200 vs 201,
    // where neither side's response-code keys are a subset of the
    // other's).
    const superset = tryFoldSupersets(list);
    if (superset) {
      resolvedClaims.push(superset);
      continue;
    }

    // Fold constraints into definitions. A "constraint" claim is one
    // whose source section primarily talks about something else and
    // just narrows this subject (e.g., an "Order ownership" section
    // adding 403 responses to four endpoints). The merger collapses
    // it into the definition rather than surfacing it as a competing
    // alternative.
    const folded = foldConstraintsIntoDefinitions(list);
    if (folded) {
      // Replace the original list with the folded one. If the folded
      // list is now a singleton or fully-identical group, we can
      // resolve directly; otherwise the remaining definitions still
      // disagree and need user input.
      if (folded.length === 1) {
        resolvedClaims.push(folded[0]);
        continue;
      }
      if (allIdentical(folded)) {
        resolvedClaims.push(mergeIdentical(folded));
        continue;
      }
      const conflict = buildConflict(folded);
      const decision = decisionsById.get(conflict.id);
      if (decision) {
        decidedConflicts.push(buildDecided(conflict, decision));
      } else {
        openConflicts.push(conflict);
      }
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

/**
 * Drop claims with empty `{}` content when other claims in the same
 * group carry actual structured data. An empty-content claim adds no
 * information — it's typically the LLM finding a relevant section but
 * failing to extract structured fields (e.g., an ADR's "## Decision"
 * heading without quotable specifics). Surfacing it as a conflict
 * candidate just adds noise.
 *
 * If every claim in the group is empty, we keep them all so the
 * caller still gets a singleton or conflict to surface — better to
 * see the issue than silently drop everything.
 */
function dropEmptyContentClaims(list: Claim[]): Claim[] {
  const nonEmpty = list.filter((c) => !isEmptyContent(c.content));
  return nonEmpty.length > 0 ? nonEmpty : list;
}

function isEmptyContent(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content !== 'object') return false;
  if (Array.isArray(content)) return content.length === 0;
  return Object.keys(content as Record<string, unknown>).length === 0;
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
// Constraint folding
// ---------------------------------------------------------------------------

/**
 * Fold every `kind: "constraint"` claim into the matching `kind:
 * "definition"` claim via deep-merge. Returns the new list (with
 * constraints removed and definitions enriched), or `null` if any
 * constraint can't fold cleanly into any definition — in which case
 * we fall back to the original conflict-list behaviour.
 *
 *   - 0 definitions, only constraints → return null. The caller
 *     surfaces the constraints as a conflict so the user picks one;
 *     we won't silently merge two narrowing rules into something
 *     neither doc asserts.
 *   - 1+ definitions, 1+ constraints  → fold each constraint into
 *     every definition that accepts it (deep-merge succeeds). If a
 *     constraint can't fold into any definition, return null.
 *   - 0 constraints                   → return null (nothing to do;
 *     caller's existing path handles pure-definition conflicts).
 */
// ---------------------------------------------------------------------------
// Strict-subset (superset) folding — for definition-vs-definition cases
// where one claim's content shape is a clean subset of another's, with
// all overlapping leaves equal.
// ---------------------------------------------------------------------------

/**
 * Try to fold the entire group via strict subset/superset reduction.
 * Returns a single merged Claim on success, or `null` if any pair
 * fails (disjoint keys at some level, or leaf conflict).
 *
 * Stitched provenance retains every contributing doc so the user can
 * still see which sources agreed on the merged shape.
 *
 * Only applies when every claim has the same `status` (otherwise the
 * "same statement" assumption breaks).
 */
function tryFoldSupersets(list: Claim[]): Claim | null {
  if (list.length === 0) return null;
  const head = list[0];
  const status = head.metadata.status ?? null;
  let acc: unknown = head.content;
  for (let i = 1; i < list.length; i++) {
    const next = list[i];
    if ((next.metadata.status ?? null) !== status) return null;
    const result = trySubsetMerge(acc, next.content);
    if (!result.ok) return null;
    acc = result.value;
  }
  const additionalSources = list.slice(1).map((c) => ({
    file: c.provenance.file,
    line: c.provenance.line,
    quote: c.provenance.quote,
  }));
  return {
    ...head,
    content: acc as Claim['content'],
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

type SubsetMergeResult = { ok: true; value: unknown } | { ok: false };

/**
 * Subset-relation deep-merge. At every nesting level, one operand's
 * keys must be a subset of (or equal to) the other operand's keys
 * — true disjoint keys at any level mean the claims aren't in a
 * superset relationship and we refuse to merge. Overlapping leaves
 * must be deep-equal.
 *
 * This is strictly more conservative than `tryDeepMerge` (used for
 * constraint folding). Constraint folding accepts disjoint keys as
 * additive because the LLM signaled the claim is a narrowing rule;
 * here we're working with two `definition` claims that could be
 * competing alternatives, so we refuse the ambiguous case.
 */
function trySubsetMerge(a: unknown, b: unknown): SubsetMergeResult {
  if (a === undefined) return { ok: true, value: b };
  if (b === undefined) return { ok: true, value: a };

  const aIsObj = isPlainObject(a);
  const bIsObj = isPlainObject(b);
  if (aIsObj && bIsObj) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    const aSetB = aKeys.every((k) => k in bObj);
    const bSetA = bKeys.every((k) => k in aObj);
    if (!aSetB && !bSetA) {
      // Neither side's keys is a subset of the other's. True disjoint
      // keys at this level — ambiguous, refuse to fold.
      return { ok: false };
    }
    const out: Record<string, unknown> = {};
    const allKeys = new Set([...aKeys, ...bKeys]);
    for (const k of allKeys) {
      const sub = trySubsetMerge(aObj[k], bObj[k]);
      if (!sub.ok) return { ok: false };
      out[k] = sub.value;
    }
    return { ok: true, value: out };
  }

  // Leaves (primitives, arrays): must be deep-equal.
  return stableStringify(a) === stableStringify(b)
    ? { ok: true, value: a }
    : { ok: false };
}

// ---------------------------------------------------------------------------
// Constraint folding (definition + constraint(s))
// ---------------------------------------------------------------------------

function foldConstraintsIntoDefinitions(list: Claim[]): Claim[] | null {
  // Treat missing kind as "definition" — the prompt explicitly tells
  // the LLM to prefer "definition" when in doubt, and synthetic
  // claims (version-chain candidates, custom resolutions) omit kind
  // entirely.
  const definitions = list.filter((c) => (c.kind ?? 'definition') === 'definition');
  const constraints = list.filter((c) => c.kind === 'constraint');
  if (constraints.length === 0) return null;
  if (definitions.length === 0) return null;

  const folded: Claim[] = [];
  for (const def of definitions) {
    let acc: unknown = def.content;
    const stitchedSources = [
      { file: def.provenance.file, line: def.provenance.line, quote: def.provenance.quote },
    ];
    for (const con of constraints) {
      const result = tryDeepMerge(acc, con.content);
      if (!result.ok) return null;
      acc = result.value;
      stitchedSources.push({
        file: con.provenance.file,
        line: con.provenance.line,
        quote: con.provenance.quote,
      });
    }
    folded.push({
      ...def,
      content: acc as Claim['content'],
      provenance: {
        ...def.provenance,
        additionalSources: stitchedSources.slice(1),
      },
    });
  }
  return folded;
}

type DeepMergeResult = { ok: true; value: unknown } | { ok: false };

/**
 * Deep-merge two values. Plain objects union their keys; for shared
 * keys we recurse. Arrays and primitives must be deep-equal.
 *
 * The merger only calls this for (definition, constraint) pairs — a
 * constraint is supposed to be additive narrowing, so a clean fold
 * means the constraint really is just adding new keys (or repeating
 * the same values). Conflicting leaves mean the constraint actually
 * disagrees with the definition, which we surface as a conflict.
 */
function tryDeepMerge(a: unknown, b: unknown): DeepMergeResult {
  if (a === undefined) return { ok: true, value: b };
  if (b === undefined) return { ok: true, value: a };

  const aIsObj = isPlainObject(a);
  const bIsObj = isPlainObject(b);
  if (aIsObj && bIsObj) {
    const out: Record<string, unknown> = {};
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const k of keys) {
      const sub = tryDeepMerge(aObj[k], bObj[k]);
      if (!sub.ok) return { ok: false };
      out[k] = sub.value;
    }
    return { ok: true, value: out };
  }

  return stableStringify(a) === stableStringify(b)
    ? { ok: true, value: a }
    : { ok: false };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

  // Default-pick rule, in priority order:
  //
  //   1. docKindAuthority — ADRs outrank PRDs outrank READMEs.
  //   2. lastTouched      — newer wins within the same kind.
  //   3. contentRichness  — when both tie (e.g. multiple sections of
  //                          the same doc describing different facets
  //                          of one subject), prefer the structurally
  //                          richest claim. This favors a full schema
  //                          over a partial lifecycle blurb or a
  //                          pricing-fields snippet, all of which can
  //                          land under the same `(topic, subject)`
  //                          group when the LLM picks the same subject
  //                          string for different sections.
  //
  // README.md often has the latest mtime by accident (a doc-update
  // commit) while being the *least* authoritative — that's why
  // authority outranks mtime, not the other way around.
  let defaultPick = 0;
  let bestRank: [number, string, number] = [
    docKindAuthority(list[0].metadata.docKind),
    list[0].metadata.lastTouched,
    contentRichness(list[0].content),
  ];
  for (let i = 1; i < list.length; i++) {
    const rank: [number, string, number] = [
      docKindAuthority(list[i].metadata.docKind),
      list[i].metadata.lastTouched,
      contentRichness(list[i].content),
    ];
    if (
      rank[0] > bestRank[0] ||
      (rank[0] === bestRank[0] &&
        (rank[1] > bestRank[1] ||
          (rank[1] === bestRank[1] && rank[2] > bestRank[2])))
    ) {
      defaultPick = i;
      bestRank = rank;
    }
  }

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
 * "Richness" score for a claim's content. Higher = more structurally
 * complete. We count recursive leaves (including array elements) —
 * a claim with `fields: {id, status, customerId, totalCents, ...}` is
 * richer than one with `fields: {status: "enum"}` even though both
 * occupy the same `(topic, subject)` slot. Used as the third-level
 * tiebreaker when authority and lastTouched both tie (typical for
 * multi-facet entity descriptions from the same doc).
 */
function contentRichness(content: unknown): number {
  if (content === null || content === undefined) return 0;
  if (typeof content !== 'object') return 1;
  if (Array.isArray(content)) {
    return content.reduce<number>((acc, v) => acc + contentRichness(v), 0);
  }
  let total = 0;
  for (const v of Object.values(content as Record<string, unknown>)) {
    total += contentRichness(v);
  }
  return total;
}

/**
 * Authority ranking for default-pick. Higher = more authoritative.
 * ADRs and RFCs are formal decision records; PRDs and specs are
 * primary requirements; runbooks and design notes describe how things
 * work; READMEs are typically project-overview prose that goes stale.
 */
function docKindAuthority(kind: DocKind): number {
  switch (kind) {
    case 'adr':
    case 'rfc':
      return 4;
    case 'prd':
    case 'spec':
      return 3;
    case 'design-note':
    case 'runbook':
      return 2;
    case 'readme':
      return 1;
    case 'unknown':
    default:
      return 0;
  }
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
