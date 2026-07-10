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
import type { CuratedCorpus, RelationType } from '@truecourse/spec-consolidator';
import { buildCorpusConflicts } from '@truecourse/shared';
import { addRelation, curateInProcess } from '@truecourse/core/commands/spec-in-process';

export interface RunSpecConflictsOptions {
  cwd?: string;
}

const root = (opts: RunSpecConflictsOptions): string => opts.cwd ?? process.cwd();
const base = (ref: string): string => ref.split('/').pop() ?? ref;

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
  const conflicts = buildCorpusConflicts(corpus, readCorpusDecisions(repoRoot));
  const open = conflicts.filter((c) => !c.resolved);
  const resolved = conflicts.length - open.length;

  p.intro('Overlaps (areas where docs may disagree)');
  for (const c of open) {
    p.log.warn(`${c.area}`);
    p.log.message(`  ${base(c.a)}  ↔  ${base(c.b)}${c.note ? `   · ${c.note}` : ''}`);
    p.log.message(`  resolve: truecourse spec conflicts resolve ${c.area} --older ${c.a} --newer ${c.b} --precedence`);
  }
  if (open.length === 0) p.log.step('No open overlaps.');
  p.outro(`${open.length} open · ${resolved} resolved. Inspect with \`spec conflicts show <area>\`.`);
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
  const conflicts = buildCorpusConflicts(corpus, readCorpusDecisions(repoRoot));
  p.intro(`Overlaps in ${area}`);
  if (a.overlaps.length === 0) p.log.step('(no overlaps in this area)');
  for (const ov of a.overlaps) {
    const [da, db] = ov.docs;
    const c = conflicts.find(
      (x) => x.area === area && ((x.a === da && x.b === db) || (x.a === db && x.b === da)),
    );
    p.log.warn(`${base(da)}  ↔  ${base(db)}${ov.note ? `   · ${ov.note}` : ''}`);
    if (c?.relation) p.log.message(`  resolved → ${c.relation.type} (${c.relation.older} ⇒ ${c.relation.newer})`);
    else if (c?.excludedRef) p.log.message(`  resolved → ${c.excludedRef} excluded`);
    else p.log.message('  open');
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

  // Span the dispute across areas: detection runs per area, so one disagreement on
  // a pair sharing several areas is flagged (and merged) across them. Scope the
  // relation to the named area only when the dispute is single-area; a cross-area
  // dispute records an unscoped (doc-pair-wide) relation so this one resolution
  // clears it everywhere and survives the re-scan.
  const conflict = buildCorpusConflicts(corpus, readCorpusDecisions(repoRoot)).find(
    (c) => (c.a === opts.older && c.b === opts.newer) || (c.a === opts.newer && c.b === opts.older),
  );
  const scope = conflict && conflict.areas.length > 1 ? undefined : area;

  await addRelation(repoRoot, {
    type: opts.type,
    older: opts.older,
    newer: opts.newer,
    scope,
    detectedFrom: 'manual',
    note: opts.note,
  });

  const s = p.spinner();
  s.start('Re-scanning to apply the relation');
  await curateInProcess(repoRoot, {});
  s.stop('Re-scanned');

  p.outro(`Recorded ${opts.type}: ${opts.older} ⇒ ${opts.newer} (scope ${scope ?? 'all areas'}).`);
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
