/**
 * Corpus-driven generation input for the contract extractor. Reads the curated
 * corpus (`.truecourse/specs/corpus.json`), applies the effective doc→doc
 * relations, and builds one `AreaGenInput` per area — the area's relevant docs
 * (full markdown), `replace`-d docs dropped, ordered by precedence.
 *
 * Generate then reads MULTIPLE docs per area and consolidates across them (the
 * model does the merge + ignores non-spec prose). The corpus stores only DocRefs;
 * this module resolves each to content (a repo file in OSS, a blob in EE via an
 * injected resolver).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readCorpus,
  readCorpusDecisions,
  effectiveRelations,
  isProcessArea,
  splitArea,
  type CuratedCorpus,
  type DecisionsFile,
  type Relation,
  type Status,
  type DocKind,
} from '@truecourse/spec-consolidator';

/** One source doc fed to generate for an area — the full markdown plus metadata. */
export interface AreaDoc {
  /** DocRef (repo-relative path in OSS). */
  ref: string;
  /** Full markdown content. */
  content: string;
  /** ISO timestamp — drives default precedence ordering (newest first). */
  lastTouched: string;
  /** Lifecycle status from the corpus, when known. */
  status?: Status;
  kind: DocKind;
}

/** Per-area generation input: the area + its docs in precedence order. */
export interface AreaGenInput {
  areaId: string;
  product: string;
  concern: string;
  /** Relevant docs, `replace`-d ones dropped, highest precedence first. */
  docs: AreaDoc[];
}

export interface CorpusReadOptions {
  /** Inject the corpus instead of reading `corpus.json` (EE / tests). */
  corpus?: CuratedCorpus;
  /** Inject decisions instead of reading `decisions.json` (EE / tests). */
  decisions?: DecisionsFile;
  /** Resolve a DocRef to its markdown. Default reads `<repoRoot>/<ref>`; null = missing. */
  resolveContent?: (ref: string) => string | null;
  /** Include process-bucket areas (default false — they spec no behavior). */
  includeProcess?: boolean;
}

/** True when a usable `corpus.json` exists. */
export function hasCorpusSpec(repoRoot: string): boolean {
  return readCorpus(repoRoot) !== null;
}

/**
 * Read the corpus and build the per-area generation inputs: effective relations
 * applied (`replace`-d docs dropped, precedence ordered), process areas and
 * empty areas excluded, DocRefs resolved to content.
 */
export function readCorpusForGenerate(repoRoot: string, opts: CorpusReadOptions = {}): AreaGenInput[] {
  const corpus = opts.corpus ?? readCorpus(repoRoot);
  if (!corpus) return [];
  const decisions = opts.decisions ?? readCorpusDecisions(repoRoot);
  const resolve = opts.resolveContent ?? ((ref: string) => defaultResolveContent(repoRoot, ref));

  const relations = effectiveRelations(corpus.relations, decisions.relations ?? []);
  const docByRef = new Map(corpus.docs.map((d) => [d.ref, d]));

  const out: AreaGenInput[] = [];
  for (const area of corpus.areas) {
    if (!opts.includeProcess && isProcessArea(area.id)) continue;

    const dropped = replacedRefsForArea(area.id, new Set(area.docRefs), relations);
    const docs: AreaDoc[] = [];
    for (const ref of area.docRefs) {
      if (dropped.has(ref)) continue;
      const content = resolve(ref);
      if (content == null) continue; // unresolvable ref — skip rather than fail the run
      const cd = docByRef.get(ref);
      docs.push({
        ref,
        content,
        lastTouched: cd?.lastTouched ?? '',
        status: cd?.status,
        kind: cd?.kind ?? 'unknown',
      });
    }
    if (docs.length === 0) continue;

    orderByPrecedence(docs, area.id, relations);
    const { product, concern } = splitArea(area.id);
    out.push({ areaId: area.id, product, concern, docs });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relation application
// ---------------------------------------------------------------------------

/**
 * Refs dropped from an area because a `replace` relation supersedes them there.
 * AREA-LOCAL: only drop `older` when its replacement `newer` ALSO co-occurs in
 * this area, so a replace whose `newer` lives in another (or excluded) area
 * cannot silently empty this one.
 */
function replacedRefsForArea(areaId: string, areaRefs: Set<string>, relations: Relation[]): Set<string> {
  const dropped = new Set<string>();
  for (const r of relations) {
    if (r.type !== 'replace') continue;
    if (r.scope && r.scope !== areaId) continue; // scoped to a different area
    if (!areaRefs.has(r.newer) || !areaRefs.has(r.older)) continue;
    dropped.add(r.older);
  }
  return dropped;
}

/**
 * Order docs by precedence (highest authority first) via a TOPOLOGICAL sort over
 * the area's `precedence` edges (`newer` must precede `older`), with recency
 * (lastTouched desc, then ref) as the tiebreak for incomparable docs. A genuine
 * topo order honors every explicit `newer > older` edge — a scalar net-degree
 * score does not (it can invert a doc past one it explicitly outranks). Cycles
 * (shouldn't occur) fall back to recency for the remainder.
 */
function orderByPrecedence(docs: AreaDoc[], areaId: string, relations: Relation[]): void {
  const refs = new Set(docs.map((d) => d.ref));
  const byRef = new Map(docs.map((d) => [d.ref, d]));
  const successors = new Map<string, Set<string>>(); // newer → {older it precedes}
  const indeg = new Map<string, number>(docs.map((d) => [d.ref, 0]));
  for (const r of relations) {
    if (r.type !== 'precedence') continue;
    if (r.scope && r.scope !== areaId) continue;
    if (!refs.has(r.newer) || !refs.has(r.older) || r.newer === r.older) continue;
    const succ = successors.get(r.newer) ?? new Set<string>();
    if (succ.has(r.older)) continue; // dedupe parallel edges
    succ.add(r.older);
    successors.set(r.newer, succ);
    indeg.set(r.older, (indeg.get(r.older) ?? 0) + 1);
  }

  const recencyCmp = (a: string, b: string): number => {
    const da = byRef.get(a)!;
    const db = byRef.get(b)!;
    if (da.lastTouched !== db.lastTouched) return da.lastTouched < db.lastTouched ? 1 : -1; // newer first
    return a < b ? -1 : 1;
  };

  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < docs.length) {
    const ready = docs.map((d) => d.ref).filter((r) => !placed.has(r) && (indeg.get(r) ?? 0) === 0);
    const pool = ready.length > 0 ? ready : docs.map((d) => d.ref).filter((r) => !placed.has(r)); // cycle break
    pool.sort(recencyCmp);
    const pick = pool[0];
    order.push(pick);
    placed.add(pick);
    for (const older of successors.get(pick) ?? []) indeg.set(older, (indeg.get(older) ?? 1) - 1);
  }

  const rank = new Map(order.map((ref, i) => [ref, i]));
  docs.sort((a, b) => (rank.get(a.ref) ?? 0) - (rank.get(b.ref) ?? 0));
}

function defaultResolveContent(repoRoot: string, ref: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, ref), 'utf-8');
  } catch {
    return null;
  }
}
