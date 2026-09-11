/**
 * Re-subject one repository's DECISIONS under the context ref grammar, and fold
 * them into the workspace's.
 *
 * A decision is a standing choice about a DOCUMENT — keep it, drop it, this side
 * of this disagreement wins, this subtree is out of scope — and documents moved
 * when they became the workspace's: `docs/x.md` is now
 * `context/<repository source>/docs/x.md`, and a page of an old llms.txt
 * registry is `context/<the migrated site source>/<path>`. A row whose subject
 * cannot be mapped is DROPPED with its reason, because a decision about a
 * document nobody can name is not one anybody can act on.
 *
 * Pure: the caller supplies the id maps it read from its store and gets back the
 * folded document plus what was dropped. The merge rules are the ones the scan
 * itself folds by — a USER row wins over an AUTO row for the same subject, two
 * repositories that disagree on one conflict keep the NEWER resolution, and
 * includes / excludes / instructions are unions by value.
 */

import type {
  ConflictResolution,
  DecisionsFile,
  ManualArea,
  ScopeVerdict,
} from '@truecourse/spec-consolidator';
import { contextDocRef, isValidContextDocPath } from '../../lib/context-ref.js';

/** The old per-repository grammar's prefix for a registered site's snapshots. */
const OLD_SOURCES_PREFIX = '.truecourse/specs/sources';

export interface DecisionsFoldInput {
  /** The workspace source id that IS this repository's own documentation. */
  repositorySourceId: string;
  /** Old registry source id → the workspace site source it became. */
  siteSourceIds?: ReadonlyMap<string, string>;
  /** Named in the log lines the caller writes. */
  repoFullName?: string;
}

/** One row the fold could not place, and why. */
export interface DroppedDecision {
  kind: 'include' | 'exclude' | 'area' | 'scope' | 'conflict' | 'instruction';
  subject: string;
  reason: string;
}

/** One disagreement the fold settled between two repositories. */
export interface DecisionConflictNote {
  subject: string;
  kept: string;
  dropped: string;
}

export interface DecisionsFoldResult {
  decisions: DecisionsFile;
  /** Whether anything actually landed (nothing ⇒ the caller need not write). */
  changed: boolean;
  folded: number;
  dropped: DroppedDecision[];
  /** Same-subject disagreements the newer call won. */
  settled: DecisionConflictNote[];
}

/** A verdict path, normalized: no trailing slash (`docs/` and `docs` are one). */
export function normalizeDecisionPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  return trimmed === '' ? '.' : trimmed;
}

/** A decisions document with every list present, so a fold can push into it. */
export function fullDecisions(base?: DecisionsFile | null): DecisionsFile {
  return {
    version: 2,
    manualIncludes: [...(base?.manualIncludes ?? [])],
    manualExcludes: [...(base?.manualExcludes ?? [])],
    manualAreas: [...(base?.manualAreas ?? [])],
    conflictResolutions: [...(base?.conflictResolutions ?? [])],
    scopeVerdicts: [...(base?.scopeVerdicts ?? [])],
    instructions: [...(base?.instructions ?? [])],
  };
}

/** A repository doc ref under the new grammar, or null when it maps to nothing. */
export function mapDecisionDocRef(ref: string, input: DecisionsFoldInput): string | null {
  if (ref.startsWith(`${OLD_SOURCES_PREFIX}/`)) {
    const rest = ref.slice(OLD_SOURCES_PREFIX.length + 1);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const next = input.siteSourceIds?.get(rest.slice(0, slash));
    return next ? safeRef(next, rest.slice(slash + 1)) : null;
  }
  return safeRef(input.repositorySourceId, ref);
}

/**
 * A scope verdict's subject under the new grammar. `.` (the repository's root
 * files as a group) becomes the repository's whole source, a directory prefix
 * becomes that subtree inside it, and an old registry source id becomes the
 * workspace site source it turned into.
 */
export function mapDecisionScopePath(path: string, input: DecisionsFoldInput): string | null {
  const normalized = normalizeDecisionPath(path);
  if (normalized === '.') return `context/${input.repositorySourceId}`;
  const site = input.siteSourceIds?.get(normalized);
  if (site) return site;
  if (normalized.startsWith(`${OLD_SOURCES_PREFIX}/`) || normalized === OLD_SOURCES_PREFIX) {
    const rest = normalized.slice(OLD_SOURCES_PREFIX.length).replace(/^\//, '');
    if (!rest) return null;
    const slash = rest.indexOf('/');
    const id = slash === -1 ? rest : rest.slice(0, slash);
    const next = input.siteSourceIds?.get(id);
    if (!next) return null;
    return slash === -1 ? next : `context/${next}/${rest.slice(slash + 1)}`;
  }
  return `context/${input.repositorySourceId}/${normalized}`;
}

function safeRef(sourceId: string, docPath: string): string | null {
  const normalized = docPath.split('\\').join('/');
  if (!isValidContextDocPath(normalized)) return null;
  try {
    return contextDocRef(sourceId, normalized);
  } catch {
    return null;
  }
}

/** The dispute identity two resolutions share: the unordered pair + anchors. */
export function sameDispute(a: ConflictResolution, b: ConflictResolution): boolean {
  const key = (row: ConflictResolution): string =>
    [`${row.docA}#${row.anchorA ?? ''}`, `${row.docB}#${row.anchorB ?? ''}`].sort().join('||');
  return key(a) === key(b);
}

/**
 * Fold one repository's decisions into `workspace` (which is not mutated).
 * Idempotent: every row is keyed by its own subject, so folding twice writes the
 * same document.
 */
export function foldRepoDecisions(
  workspace: DecisionsFile | null,
  stored: DecisionsFile,
  input: DecisionsFoldInput,
): DecisionsFoldResult {
  const out = fullDecisions(workspace);
  const dropped: DroppedDecision[] = [];
  const settled: DecisionConflictNote[] = [];
  let folded = 0;

  const push = (kind: DroppedDecision['kind'], subject: string): void => {
    dropped.push({ kind, subject, reason: 'no such document under the new grammar' });
  };

  for (const ref of stored.manualIncludes ?? []) {
    const mapped = mapDecisionDocRef(ref, input);
    if (!mapped) {
      push('include', ref);
      continue;
    }
    if (!out.manualIncludes.includes(mapped)) {
      out.manualIncludes.push(mapped);
      folded += 1;
    }
  }

  for (const ref of stored.manualExcludes ?? []) {
    const mapped = mapDecisionDocRef(ref, input);
    if (!mapped) {
      push('exclude', ref);
      continue;
    }
    if (!out.manualExcludes.includes(mapped)) {
      out.manualExcludes.push(mapped);
      folded += 1;
    }
  }

  for (const area of stored.manualAreas ?? []) {
    const mapped = mapDecisionDocRef(area.doc, input);
    if (!mapped) {
      push('area', area.doc);
      continue;
    }
    if (out.manualAreas.some((row) => row.doc === mapped)) continue;
    const next: ManualArea = { doc: mapped, areas: [...area.areas] };
    out.manualAreas.push(next);
    folded += 1;
  }

  for (const verdict of stored.scopeVerdicts ?? []) {
    const mapped = mapDecisionScopePath(verdict.path, input);
    if (!mapped) {
      push('scope', verdict.path);
      continue;
    }
    const next: ScopeVerdict = { ...verdict, path: mapped };
    const at = out.scopeVerdicts.findIndex((row) => row.path === mapped);
    if (at === -1) {
      out.scopeVerdicts.push(next);
      folded += 1;
    } else if (out.scopeVerdicts[at].resolvedBy === 'auto' && next.resolvedBy !== 'auto') {
      // A human's call replaces the session's, never the other way round.
      out.scopeVerdicts[at] = next;
      folded += 1;
    }
  }

  for (const resolution of stored.conflictResolutions ?? []) {
    const docA = mapDecisionDocRef(resolution.docA, input);
    const docB = mapDecisionDocRef(resolution.docB, input);
    if (!docA || !docB) {
      push('conflict', `${resolution.docA} / ${resolution.docB}`);
      continue;
    }
    const next: ConflictResolution = { ...resolution, docA, docB };
    const at = out.conflictResolutions.findIndex((row) => sameDispute(row, next));
    if (at === -1) {
      out.conflictResolutions.push(next);
      folded += 1;
      continue;
    }
    const held = out.conflictResolutions[at];
    if (held.resolvedBy === 'auto' && next.resolvedBy !== 'auto') {
      out.conflictResolutions[at] = next;
      folded += 1;
      continue;
    }
    if (held.verdict === next.verdict) continue;
    // Two repositories read the same documents and settled the disagreement
    // differently. The workspace settles it once: the newer call stands.
    const subject = `${docA} / ${docB}`;
    if (next.resolvedAt > held.resolvedAt) {
      out.conflictResolutions[at] = next;
      folded += 1;
      settled.push({ subject, kept: next.verdict, dropped: held.verdict });
    } else {
      settled.push({ subject, kept: held.verdict, dropped: next.verdict });
    }
  }

  for (const instruction of stored.instructions ?? []) {
    if (!out.instructions.includes(instruction)) {
      out.instructions.push(instruction);
      folded += 1;
    }
  }

  return { decisions: out, changed: folded > 0, folded, dropped, settled };
}
