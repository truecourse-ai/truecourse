/**
 * `truecourse spec conflicts <sub>` — corpus overlap surface (agent-friendly).
 *
 * In the curated-corpus model a "conflict" is a flagged within-area OVERLAP —
 * two docs in the same area that may disagree. The user resolves it by recording
 * a doc→doc RELATION (replace / precedence / keep-both).
 *
 *   list                         flagged overlaps still awaiting a relation
 *   show <area>                  the overlapping docs' prose excerpts for one area
 *   resolve <area> --older P --newer P --replace|--precedence|--keep-both [--note]
 *                                record the relation for the pair, then re-scan
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import { readCorpus, readCorpusDecisions } from '@truecourse/spec-consolidator';
import type { CuratedCorpus, Relation, RelationType } from '@truecourse/spec-consolidator';
import { addRelation, curateInProcess } from '@truecourse/core/commands/spec-in-process';

export interface RunSpecConflictsOptions {
  cwd?: string;
}

const root = (opts: RunSpecConflictsOptions): string => opts.cwd ?? process.cwd();
const base = (ref: string): string => ref.split('/').pop() ?? ref;

/** Effective relation set = corpus auto-detected ∪ user-authored (decisions). */
function effectiveRelations(corpus: CuratedCorpus, repoRoot: string): Relation[] {
  const user = readCorpusDecisions(repoRoot).relations ?? [];
  return [...corpus.relations, ...user];
}

/** A relation covers an overlap pair when it names both docs (either order) and is unscoped or scoped to this area. */
function coveringRelation(rels: Relation[], a: string, b: string, area: string): Relation | undefined {
  return rels.find((r) => {
    const samePair = (r.older === a && r.newer === b) || (r.older === b && r.newer === a);
    return samePair && (r.scope === undefined || r.scope === area);
  });
}

function loadCorpusOrExit(repoRoot: string): CuratedCorpus {
  const corpus = readCorpus(repoRoot);
  if (!corpus) {
    p.cancel('No corpus found — run `truecourse spec scan` first.');
    process.exit(1);
  }
  return corpus;
}

export async function runSpecConflictsList(opts: RunSpecConflictsOptions = {}): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot);
  const rels = effectiveRelations(corpus, repoRoot);

  let open = 0;
  let resolved = 0;
  p.intro('Overlaps (areas where docs may disagree)');
  for (const area of corpus.areas) {
    for (const ov of area.overlaps) {
      const [a, b] = ov.docs;
      if (coveringRelation(rels, a, b, area.id)) {
        resolved++;
        continue;
      }
      open++;
      p.log.warn(`${area.id}`);
      p.log.message(`  ${base(a)}  ↔  ${base(b)}${ov.note ? `   · ${ov.note}` : ''}`);
      p.log.message(`  resolve: truecourse spec conflicts resolve ${area.id} --older ${a} --newer ${b} --precedence`);
    }
  }
  if (open === 0) p.log.step('No open overlaps.');
  p.outro(`${open} open · ${resolved} resolved. Inspect with \`spec conflicts show <area>\`.`);
}

/** First ~`max` lines of a doc, preferring the window around the overlap note's terms. */
function excerpt(repoRoot: string, ref: string, note: string, max = 20): string {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, ref), 'utf-8');
  } catch {
    return `    (could not read ${ref})`;
  }
  const lines = text.split('\n');
  const terms = note
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 4);
  const hit = terms.length ? lines.findIndex((l) => terms.some((t) => l.toLowerCase().includes(t))) : -1;
  const start = hit > 3 ? hit - 2 : 0;
  return lines
    .slice(start, start + max)
    .map((l) => `    ${l}`)
    .join('\n');
}

export async function runSpecConflictsShow(area: string, opts: RunSpecConflictsOptions = {}): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot);
  const a = corpus.areas.find((x) => x.id === area);
  if (!a) {
    p.cancel(`No such area: ${area}. List areas with \`spec status\`.`);
    process.exit(1);
  }
  const rels = effectiveRelations(corpus, repoRoot);
  p.intro(`Overlaps in ${area}`);
  if (a.overlaps.length === 0) p.log.step('(no overlaps in this area)');
  for (const ov of a.overlaps) {
    const [da, db] = ov.docs;
    const rel = coveringRelation(rels, da, db, area);
    p.log.warn(`${base(da)}  ↔  ${base(db)}${ov.note ? `   · ${ov.note}` : ''}`);
    p.log.message(rel ? `  resolved → ${rel.type} (${rel.older} ⇒ ${rel.newer})` : '  open');
    p.log.message(`  ${da}:`);
    p.log.message(excerpt(repoRoot, da, ov.note));
    p.log.message(`  ${db}:`);
    p.log.message(excerpt(repoRoot, db, ov.note));
  }
  p.outro('resolve with `spec conflicts resolve <area> --older P --newer P --replace|--precedence|--keep-both`.');
}

export async function runSpecConflictsResolve(
  area: string,
  opts: RunSpecConflictsOptions & { older: string; newer: string; type: RelationType; note?: string },
): Promise<void> {
  const repoRoot = root(opts);
  if (!opts.older || !opts.newer) return fail('resolve needs --older <path> and --newer <path>');
  if (opts.older === opts.newer) return fail('--older and --newer must be different docs');

  const corpus = loadCorpusOrExit(repoRoot);
  const a = corpus.areas.find((x) => x.id === area);
  if (!a) return fail(`No such area: ${area}.`);
  const known = new Set(a.docRefs);
  for (const ref of [opts.older, opts.newer]) {
    if (!known.has(ref)) return fail(`${ref} is not a doc in area ${area}. Docs: ${a.docRefs.join(', ')}`);
  }

  await addRelation(repoRoot, {
    type: opts.type,
    older: opts.older,
    newer: opts.newer,
    scope: area,
    detectedFrom: 'manual',
    note: opts.note,
  });

  const s = p.spinner();
  s.start('Re-scanning to apply the relation');
  await curateInProcess(repoRoot, {});
  s.stop('Re-scanned');

  p.outro(`Recorded ${opts.type}: ${opts.older} ⇒ ${opts.newer} (scope ${area}).`);
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
