/**
 * `truecourse spec conflicts <sub>` — corpus overlap surface (agent-friendly).
 *
 * In the curated-corpus model a "conflict" is a flagged within-area OVERLAP —
 * two docs whose specific sections may disagree. It resolves with a
 * SECTION-scoped verdict on the disagreement itself (plan item 31):
 *   - pick a side  (`--right <docPath>`) — the other side's disputed claim is
 *                  suppressed at guard generate; the winner stands.
 *   - dismiss      (`--dismiss`)          — a detector false-positive; resolves
 *                  the gate, suppresses nothing.
 * A conflict resolves ONLY via a verdict, a dismissal, or a force-exclude.
 *
 *   list                         flagged overlaps + their resolved/dismissed state
 *   show <area>                  the overlapping docs' prose excerpts for one area
 *   resolve <n|area> --right P   pick a side (loser's claim suppressed at generate)
 *   resolve <n|area> --dismiss   mark not-a-real-conflict
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import { readCorpus, readCorpusDecisions } from '@truecourse/spec-consolidator';
import type { CuratedCorpus, ConflictResolution } from '@truecourse/spec-consolidator';
import {
  buildCorpusConflicts,
  orphanedConflictResolutions,
  type CorpusConflict,
} from '@truecourse/shared';
import { addConflictResolution } from '@truecourse/core/commands/spec-in-process';

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

/** How a conflict is resolved, for the list/show rendering. */
function resolvedLabel(c: CorpusConflict): string {
  if (c.resolution) {
    if (c.resolution.verdict === 'dismissed') return 'dismissed (not a real conflict)';
    const winner = c.resolution.verdict === 'a' ? c.resolution.docA : c.resolution.docB;
    return `${base(winner)} is right (loser’s claim suppressed at generate)`;
  }
  if (c.excludedRef) return `${base(c.excludedRef)} excluded`;
  return 'resolved';
}

export async function runSpecConflictsList(opts: RunSpecConflictsOptions = {}): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot);
  const decisions = readCorpusDecisions(repoRoot);
  const conflicts = buildCorpusConflicts(corpus, decisions);
  const open = conflicts.filter((c) => !c.resolved);
  const orphaned = orphanedConflictResolutions(corpus, decisions);

  p.intro('Overlaps (where two docs’ sections may disagree)');
  // Number every conflict so `resolve <n>` addresses it directly.
  conflicts.forEach((c, i) => {
    const n = i + 1;
    if (c.resolved) {
      p.log.step(`${n}. ${c.area}  ·  ${base(c.a)}  ↔  ${base(c.b)}  — resolved: ${resolvedLabel(c)}`);
    } else {
      p.log.warn(`${n}. ${c.area}  ·  ${base(c.a)}  ↔  ${base(c.b)}${c.note ? `   · ${c.note}` : ''}`);
      p.log.message(`   pick a side: truecourse spec conflicts resolve ${n} --right ${c.a}   (or --right ${c.b}, or --dismiss)`);
    }
  });
  if (conflicts.length === 0) p.log.step('No overlaps flagged.');

  if (orphaned.length > 0) {
    p.log.warn(
      `${orphaned.length} orphaned resolution${orphaned.length === 1 ? '' : 's'} — recorded but no longer match a flagged conflict (the docs changed):`,
    );
    for (const o of orphaned) p.log.message(`   ${base(o.docA)}  ↔  ${base(o.docB)}  (${o.verdict})`);
  }
  p.outro(
    `${open.length} open · ${conflicts.length - open.length} resolved${orphaned.length ? ` · ${orphaned.length} orphaned` : ''}. Inspect with \`spec conflicts show <area>\`.`,
  );
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
      (x) => (x.areas.includes(area) || x.area === area) && ((x.a === da && x.b === db) || (x.a === db && x.b === da)),
    );
    p.log.warn(`${base(da)}  ↔  ${base(db)}${ov.note ? `   · ${ov.note}` : ''}`);
    p.log.message(c && c.resolved ? `  resolved → ${resolvedLabel(c)}` : '  open');
    p.log.message(`  ${da}:`);
    p.log.message(excerpt(repoRoot, da, ov.note));
    p.log.message(`  ${db}:`);
    p.log.message(excerpt(repoRoot, db, ov.note));
  }
  p.outro('resolve with `spec conflicts resolve <n|area> --right <docPath>` (pick a side) or `--dismiss`.');
}

export interface RunSpecConflictsResolveOptions extends RunSpecConflictsOptions {
  /** Side verdict — the winning doc path (loser's disputed claim is suppressed). */
  right?: string;
  /** Dismiss the conflict as a detector false-positive. */
  dismiss?: boolean;
  /** Optional rationale, persisted on the verdict. */
  note?: string;
}

/** Identify the target conflict for a section-scoped verdict from `<n|area>`. */
function pickConflict(
  target: string,
  conflicts: CorpusConflict[],
  right: string | undefined,
): CorpusConflict | { error: string } {
  if (/^\d+$/.test(target)) {
    const idx = Number(target) - 1;
    if (idx < 0 || idx >= conflicts.length) {
      return { error: `No conflict #${target}. Run \`spec conflicts list\` (${conflicts.length} listed).` };
    }
    return conflicts[idx];
  }
  // Area form: the conflicts flagged in this area, narrowed by --right when given.
  let inArea = conflicts.filter((c) => c.areas.includes(target) || c.area === target);
  if (inArea.length === 0) return { error: `No conflicts in area ${target}. List them with \`spec conflicts list\`.` };
  if (right) inArea = inArea.filter((c) => c.a === right || c.b === right);
  if (inArea.length === 0) return { error: `No conflict in ${target} involves ${right}.` };
  if (inArea.length > 1) {
    return { error: `Area ${target} has ${inArea.length} conflicts — address one by its number (\`spec conflicts list\`).` };
  }
  return inArea[0];
}

/** Build the persisted resolution from a conflict + verdict. */
function buildResolution(
  c: CorpusConflict,
  verdict: 'a' | 'b' | 'dismissed',
  note?: string,
): ConflictResolution {
  const secOf = (doc: string) => (c.sections ?? []).find((s) => s.doc === doc);
  return {
    docA: c.a,
    anchorA: secOf(c.a)?.heading ?? null,
    quoteA: secOf(c.a)?.quote,
    docB: c.b,
    anchorB: secOf(c.b)?.heading ?? null,
    quoteB: secOf(c.b)?.quote,
    verdict,
    resolvedAt: new Date().toISOString(),
    note,
  };
}

export async function runSpecConflictsResolve(
  target: string,
  opts: RunSpecConflictsResolveOptions,
): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot);
  const decisions = readCorpusDecisions(repoRoot);

  if (!opts.right && !opts.dismiss) {
    return fail('Pass --right <docPath> (pick a side) or --dismiss.');
  }
  if (opts.right && opts.dismiss) return fail('Pass either --right <docPath> or --dismiss, not both.');
  const conflicts = buildCorpusConflicts(corpus, decisions);
  const picked = pickConflict(target, conflicts, opts.right);
  if ('error' in picked) return fail(picked.error);

  let verdict: 'a' | 'b' | 'dismissed';
  if (opts.dismiss) {
    verdict = 'dismissed';
  } else {
    if (opts.right !== picked.a && opts.right !== picked.b) {
      return fail(`--right must be one of the disputing docs: ${picked.a} or ${picked.b}.`);
    }
    verdict = opts.right === picked.a ? 'a' : 'b';
  }

  await addConflictResolution(repoRoot, buildResolution(picked, verdict, opts.note));
  // No re-scan: the corpus is unchanged and the resolved-derivation reads the
  // verdict live; a single later `spec scan` applies any batch (the skips model).
  if (verdict === 'dismissed') {
    p.outro(`Dismissed: ${base(picked.a)} ↔ ${base(picked.b)} is not a real conflict.`);
  } else {
    const winner = verdict === 'a' ? picked.a : picked.b;
    const loser = verdict === 'a' ? picked.b : picked.a;
    p.outro(`Recorded: ${base(winner)} is right. ${base(loser)}’s disputed claim is suppressed at \`truecourse guard generate\`.`);
  }
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}
