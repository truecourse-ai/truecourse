/**
 * `truecourse spec conflicts <sub>` — corpus overlap surface (agent-friendly).
 *
 * In the curated-corpus model a "conflict" is a flagged within-area OVERLAP —
 * two docs whose specific sections may disagree. It resolves with a
 * SECTION-scoped verdict on the disagreement itself:
 *   - pick a side  (`--right <docPath>`) — the other side's disputed claim is
 *                  suppressed at guard generate; the winner stands.
 *   - dismiss      (`--dismiss`)          — a detector false-positive; resolves
 *                  the gate, suppresses nothing.
 * A conflict resolves ONLY via a verdict, a dismissal, or a force-exclude.
 *
 *   list [--json]                    flagged overlaps + their resolved/dismissed state
 *   show <n|area> [--json]           the overlapping docs' disputed SECTION passages
 *   resolve <n…|area> --right P      pick a side (loser's claim suppressed at generate)
 *   resolve <n…|area> --dismiss      mark not-a-real-conflict (accepts many indexes)
 *   resolve --area <id> --dismiss    dismiss every conflict in an area
 *   resolve <n> --recommended        apply the verify pass's recommendation
 *
 * The conflict index is `buildCorpusConflicts`'s array order — IDENTICAL across
 * `list`, `show`, and `resolve`.
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import { readCorpus, readCorpusDecisions } from '@truecourse/spec-consolidator';
import type { CuratedCorpus, ConflictResolution } from '@truecourse/spec-consolidator';
import {
  buildCorpusConflicts,
  orphanedConflictResolutions,
  parseHeadings,
  normalizeQuote,
  type CorpusConflict,
} from '@truecourse/shared';
import { addConflictResolution } from '@truecourse/core/commands/spec-in-process';

export interface RunSpecConflictsOptions {
  cwd?: string;
  /** Emit raw JSON to stdout with zero clack/TUI decoration. */
  json?: boolean;
}

const root = (opts: RunSpecConflictsOptions): string => opts.cwd ?? process.cwd();
const base = (ref: string): string => ref.split('/').pop() ?? ref;

/** Long sections cap here in the human view, with an explicit "… (+N more)" tail. */
const CAP_LINES = 60;

function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

/** JSON mode → error to stderr; human mode → clack cancel. Always exits 1. */
function fail(msg: string, opts?: RunSpecConflictsOptions): never {
  if (opts?.json) process.stderr.write(msg + '\n');
  else p.cancel(msg);
  process.exit(1);
}

function loadCorpusOrExit(repoRoot: string, opts: RunSpecConflictsOptions): CuratedCorpus {
  const corpus = readCorpus(repoRoot);
  if (!corpus) fail('No corpus found — run `truecourse spec scan` first.', opts);
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

// ---------------------------------------------------------------------------
// Verify-pass review (parallel-agent field) — read structurally so this file
// compiles whether or not `review` is in @truecourse/spec-consolidator's dist.
// ---------------------------------------------------------------------------

interface ReviewRecommendation {
  action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss';
  rationale: string;
  fix?: string;
}
interface OverlapReviewLike {
  explanation: string;
  recommendation: ReviewRecommendation;
}

/** The `review` brief on an overlap, if the verify pass stamped a well-formed one. */
function overlapReviewOf(ov: unknown): OverlapReviewLike | undefined {
  const r = (ov as { review?: unknown }).review;
  if (
    r &&
    typeof r === 'object' &&
    typeof (r as { explanation?: unknown }).explanation === 'string' &&
    typeof (r as { recommendation?: unknown }).recommendation === 'object' &&
    (r as { recommendation: { action?: unknown } }).recommendation.action !== undefined
  ) {
    return r as OverlapReviewLike;
  }
  return undefined;
}

/** Stable key set for an overlap/conflict's section pointers (order-independent). */
function sectionKeys(sections: readonly { doc: string; heading: string | null }[] | undefined): string[] {
  return (sections ?? [])
    .map((s) => `${s.doc}\x00${s.heading === null || s.heading === undefined ? '\x00lead' : s.heading}`)
    .sort();
}
function sameSections(
  a: readonly { doc: string; heading: string | null }[] | undefined,
  b: readonly { doc: string; heading: string | null }[] | undefined,
): boolean {
  const ka = sectionKeys(a);
  const kb = sectionKeys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/**
 * The verify-pass review for a conflict, resolved from the REPRESENTATIVE overlap
 * (docs order `[c.a, c.b]`, matching section pointers) so a `pick-a`/`pick-b`
 * recommendation orients exactly as `c.a`/`c.b`.
 */
function reviewForConflict(corpus: CuratedCorpus, c: CorpusConflict): OverlapReviewLike | undefined {
  const areaIds = [c.area, ...c.areas.filter((a) => a !== c.area)];
  for (const areaId of areaIds) {
    const area = corpus.areas.find((a) => a.id === areaId);
    if (!area) continue;
    for (const ov of area.overlaps) {
      if (ov.docs[0] === c.a && ov.docs[1] === c.b && sameSections(ov.sections, c.sections)) {
        const r = overlapReviewOf(ov);
        if (r) return r;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Disputed-passage resolution — the SECTION each pointer names, with an anchor.
// ---------------------------------------------------------------------------

interface OverlapSectionPtr {
  doc: string;
  heading: string | null;
  quote?: string;
}

interface ResolvedExcerpt {
  doc: string;
  /** The resolved heading, or `null` for the doc's lead/preamble. */
  heading: string | null;
  /** 1-based line of the section heading (1 for the lead); 0 when unreadable. */
  line: number;
  /** The section's own text (full; the human view caps + tails). */
  text: string;
}

/** Fold inline markdown markers + case so a backtick-styled heading still matches. */
function normHeading(s: string): string {
  return s.replace(/[`*_~]/g, '').trim().toLowerCase();
}

type Heading = { level: number; text: string; line: number };

/** [start, end) line span of the section a heading owns — to the next same-or-shallower heading. */
function sectionBounds(lines: string[], headings: Heading[], chosen: Heading): { start: number; end: number } {
  let end = lines.length;
  for (const h of headings) {
    if (h.line > chosen.line && h.level <= chosen.level) {
      end = h.line;
      break;
    }
  }
  return { start: chosen.line, end };
}

function sectionContainsQuote(lines: string[], headings: Heading[], h: Heading, quote: string): boolean {
  const { start, end } = sectionBounds(lines, headings, h);
  return normalizeQuote(lines.slice(start, end).join(' ')).includes(normalizeQuote(quote));
}

/** First line whose text (or a small window from it) contains the normalized quote. */
function findQuoteLine(lines: string[], quote: string): number {
  const q = normalizeQuote(quote);
  if (!q) return -1;
  for (let i = 0; i < lines.length; i++) {
    if (normalizeQuote(lines[i]).includes(q)) return i;
  }
  for (let i = 0; i < lines.length; i++) {
    if (normalizeQuote(lines.slice(i, i + 4).join(' ')).includes(q)) return i;
  }
  return -1;
}

/** The doc's lead: the preamble before the first heading, or its first section. */
function leadSlice(lines: string[]): string {
  const headings = parseHeadings(lines) as Heading[];
  if (headings.length === 0) return lines.join('\n');
  const first = headings[0];
  if (first.line > 0) return lines.slice(0, first.line).join('\n');
  const { end } = sectionBounds(lines, headings, first);
  return lines.slice(0, end).join('\n');
}

/**
 * Resolve a flag's section pointer against the doc and return the section's own
 * text with a `path:line` anchor. A `null` heading (or an unresolvable one) yields
 * the doc's lead at line 1. Duplicate headings are disambiguated by the quote.
 */
function resolveExcerpt(repoRoot: string, docRef: string, section: OverlapSectionPtr | undefined): ResolvedExcerpt {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, docRef), 'utf-8');
  } catch {
    return { doc: docRef, heading: section?.heading ?? null, line: 0, text: `(could not read ${docRef})` };
  }
  const lines = text.split('\n');
  const headingPtr = section?.heading ?? null;
  const quote = section?.quote;

  if (headingPtr !== null) {
    const headings = parseHeadings(lines) as Heading[];
    const target = normHeading(headingPtr);
    const candidates = headings.filter((h) => normHeading(h.text) === target);
    let chosen: Heading | undefined;
    if (candidates.length === 1) chosen = candidates[0];
    else if (candidates.length > 1) {
      chosen =
        (quote ? candidates.find((h) => sectionContainsQuote(lines, headings, h, quote)) : undefined) ??
        candidates[0];
    }
    if (chosen) {
      const { start, end } = sectionBounds(lines, headings, chosen);
      return { doc: docRef, heading: headingPtr, line: start + 1, text: lines.slice(start, end).join('\n') };
    }
    // Pointer didn't resolve — fall back to the quote's line, else the lead.
    if (quote) {
      const qi = findQuoteLine(lines, quote);
      if (qi >= 0) {
        return { doc: docRef, heading: headingPtr, line: qi + 1, text: lines.slice(qi, qi + CAP_LINES).join('\n') };
      }
    }
    return { doc: docRef, heading: headingPtr, line: 1, text: leadSlice(lines) };
  }
  return { doc: docRef, heading: null, line: 1, text: leadSlice(lines) };
}

/** Render one resolved excerpt as ONE message block (capped at CAP_LINES with a tail pointer). */
function printExcerpt(ex: ResolvedExcerpt): void {
  const anchor = ex.line > 0 ? `${ex.doc}:${ex.line}` : ex.doc;
  const head = `${anchor}${ex.heading ? `  § ${ex.heading}` : '  (lead)'}`;
  const lines = ex.text.replace(/\n+$/, '').split('\n');
  const body = lines.slice(0, CAP_LINES).map((l) => `    ${l}`);
  if (lines.length > CAP_LINES) {
    const more = lines.length - CAP_LINES;
    const contLine = (ex.line > 0 ? ex.line : 1) + CAP_LINES;
    body.push(`    … (+${more} more line${more === 1 ? '' : 's'} at ${ex.doc}:${contLine})`);
  }
  p.log.message([head, ...body].join('\n'));
}

function recActionLabel(action: ReviewRecommendation['action'], c: CorpusConflict): string {
  switch (action) {
    case 'pick-a':
      return `pick ${base(c.a)}`;
    case 'pick-b':
      return `pick ${base(c.b)}`;
    case 'dismiss':
      return 'dismiss';
    case 'fix-doc':
      return 'fix a doc';
  }
}

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

function listJson(corpus: CuratedCorpus, c: CorpusConflict, index: number): Record<string, unknown> {
  const review = reviewForConflict(corpus, c);
  return {
    index,
    area: c.area,
    areas: c.areas,
    docs: [c.a, c.b],
    note: c.note,
    resolved: c.resolved,
    resolution: c.resolution ?? null,
    ...(review ? { explanation: review.explanation, recommendation: review.recommendation } : {}),
    sections: c.sections ?? [],
  };
}

function showJson(repoRoot: string, corpus: CuratedCorpus, c: CorpusConflict, index: number): Record<string, unknown> {
  const secOf = (doc: string): OverlapSectionPtr | undefined => (c.sections ?? []).find((s) => s.doc === doc);
  return {
    ...listJson(corpus, c, index),
    excerpts: [resolveExcerpt(repoRoot, c.a, secOf(c.a)), resolveExcerpt(repoRoot, c.b, secOf(c.b))],
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function runSpecConflictsList(opts: RunSpecConflictsOptions = {}): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot, opts);
  const decisions = readCorpusDecisions(repoRoot);
  const conflicts = buildCorpusConflicts(corpus, decisions);

  if (opts.json) {
    emitJson(conflicts.map((c, i) => listJson(corpus, c, i + 1)));
    return;
  }

  const open = conflicts.filter((c) => !c.resolved);
  const orphaned = orphanedConflictResolutions(corpus, decisions);

  p.intro('Overlaps (where two docs’ sections may disagree)');
  // Number every conflict so `resolve <n>` / `show <n>` address it directly.
  conflicts.forEach((c, i) => {
    const n = i + 1;
    if (c.resolved) {
      p.log.step(`${n}. ${c.area}  ·  ${base(c.a)}  ↔  ${base(c.b)}  — resolved: ${resolvedLabel(c)}`);
    } else {
      p.log.warn(`${n}. ${c.area}  ·  ${base(c.a)}  ↔  ${base(c.b)}${c.note ? `   · ${c.note}` : ''}`);
      const rec = reviewForConflict(corpus, c);
      if (rec) p.log.message(`   recommended: ${recActionLabel(rec.recommendation.action, c)} — ${rec.recommendation.rationale}`);
      p.log.message(`   inspect: truecourse spec conflicts show ${n}   ·   pick a side: resolve ${n} --right ${c.a}   (or --right ${c.b}, --dismiss)`);
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
    `${open.length} open · ${conflicts.length - open.length} resolved${orphaned.length ? ` · ${orphaned.length} orphaned` : ''}. Inspect with \`spec conflicts show <n|area>\`.`,
  );
}

// ---------------------------------------------------------------------------
// show <n|area>
// ---------------------------------------------------------------------------

/** Render one conflict: header, review explanation (if any), both disputed passages, recommendation. */
function renderConflictShow(repoRoot: string, corpus: CuratedCorpus, c: CorpusConflict, n: number): void {
  const review = reviewForConflict(corpus, c);
  const header = `${n}. ${c.area}  ·  ${base(c.a)}  ↔  ${base(c.b)}${c.note ? `   · ${c.note}` : ''}`;
  if (c.resolved) p.log.step(`${header}  — resolved: ${resolvedLabel(c)}`);
  else p.log.warn(header);

  if (review) {
    p.log.message('');
    p.log.message(`  Why: ${review.explanation}`);
  }
  const secOf = (doc: string): OverlapSectionPtr | undefined => (c.sections ?? []).find((s) => s.doc === doc);
  p.log.message('');
  printExcerpt(resolveExcerpt(repoRoot, c.a, secOf(c.a)));
  p.log.message('');
  printExcerpt(resolveExcerpt(repoRoot, c.b, secOf(c.b)));
  if (review) {
    p.log.message('');
    p.log.message(
      `  Recommendation: ${recActionLabel(review.recommendation.action, c)} — ${review.recommendation.rationale}`,
    );
    if (review.recommendation.fix) p.log.message(`  Fix: ${review.recommendation.fix}`);
  }
}

export async function runSpecConflictsShow(target: string, opts: RunSpecConflictsOptions = {}): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot, opts);
  const decisions = readCorpusDecisions(repoRoot);
  const conflicts = buildCorpusConflicts(corpus, decisions);

  // By index — identical numbering to `list`.
  if (/^\d+$/.test(target)) {
    const idx = Number(target) - 1;
    if (idx < 0 || idx >= conflicts.length) {
      return fail(`No conflict #${target}. Run \`spec conflicts list\` (${conflicts.length} listed).`, opts);
    }
    const c = conflicts[idx];
    if (opts.json) {
      emitJson(showJson(repoRoot, corpus, c, idx + 1));
      return;
    }
    p.intro('Overlap');
    renderConflictShow(repoRoot, corpus, c, idx + 1);
    p.outro('resolve with `spec conflicts resolve <n> --right <docPath>` (pick a side) or `--dismiss`.');
    return;
  }

  // By area — every conflict flagged in it, keeping each one's list index.
  const area = corpus.areas.find((x) => x.id === target);
  if (!area) return fail(`No such area: ${target}. List areas with \`spec status\`.`, opts);
  const inArea = conflicts
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => c.areas.includes(target) || c.area === target);

  if (opts.json) {
    emitJson(inArea.map(({ c, n }) => showJson(repoRoot, corpus, c, n)));
    return;
  }
  p.intro(`Overlaps in ${target}`);
  if (inArea.length === 0) p.log.step('(no overlaps in this area)');
  inArea.forEach(({ c, n }, i) => {
    if (i > 0) p.log.message('');
    renderConflictShow(repoRoot, corpus, c, n);
  });
  p.outro('resolve with `spec conflicts resolve <n|area> --right <docPath>` (pick a side) or `--dismiss`.');
}

// ---------------------------------------------------------------------------
// resolve <n…|area>
// ---------------------------------------------------------------------------

export interface RunSpecConflictsResolveOptions extends RunSpecConflictsOptions {
  /** Side verdict — the winning doc path (loser's disputed claim is suppressed). Single conflict only. */
  right?: string;
  /** Dismiss the conflict(s) as a detector false-positive. Accepts many indexes / `--area`. */
  dismiss?: boolean;
  /** Apply the verify pass's `review.recommendation` for a single conflict. */
  recommended?: boolean;
  /** Dismiss every conflict flagged in this area (bulk; `--dismiss` only). */
  area?: string;
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
function buildResolution(c: CorpusConflict, verdict: 'a' | 'b' | 'dismissed', note?: string): ConflictResolution {
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

/** Resolve the conflict set for a bulk dismissal from indexes / a positional area / `--area`. */
function collectDismissTargets(
  conflicts: CorpusConflict[],
  targets: string[],
  area: string | undefined,
): CorpusConflict[] | { error: string } {
  if (area) {
    if (targets.length > 0) return { error: 'Pass either conflict numbers or --area, not both.' };
    const inArea = conflicts.filter((c) => c.areas.includes(area) || c.area === area);
    if (inArea.length === 0) return { error: `No conflicts in area ${area}. List them with \`spec conflicts list\`.` };
    return inArea;
  }
  if (targets.length === 0) return { error: 'Pass one or more conflict numbers, an area, or --area <id>.' };
  if (targets.every((t) => /^\d+$/.test(t))) {
    const picked: CorpusConflict[] = [];
    const seen = new Set<number>();
    for (const t of targets) {
      const idx = Number(t) - 1;
      if (idx < 0 || idx >= conflicts.length) {
        return { error: `No conflict #${t}. Run \`spec conflicts list\` (${conflicts.length} listed).` };
      }
      if (seen.has(idx)) continue;
      seen.add(idx);
      picked.push(conflicts[idx]);
    }
    return picked;
  }
  // A single non-numeric target is an area (backcompat `resolve <area> --dismiss`).
  if (targets.length === 1) {
    const one = pickConflict(targets[0], conflicts, undefined);
    return 'error' in one ? one : [one];
  }
  return { error: 'Mix of numbers and an area — dismiss by numbers, or a whole area with a single area id / --area.' };
}

export async function runSpecConflictsResolve(
  target: string | string[],
  opts: RunSpecConflictsResolveOptions,
): Promise<void> {
  const repoRoot = root(opts);
  const corpus = loadCorpusOrExit(repoRoot, opts);
  const decisions = readCorpusDecisions(repoRoot);
  const conflicts = buildCorpusConflicts(corpus, decisions);
  const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);

  const modes = [opts.right ? 'right' : '', opts.dismiss ? 'dismiss' : '', opts.recommended ? 'recommended' : ''].filter(
    Boolean,
  );
  if (modes.length === 0) return fail('Pass --right <docPath> (pick a side), --dismiss, or --recommended.');
  if (modes.length > 1) return fail('Pass only one of --right, --dismiss, or --recommended.');

  if (opts.recommended) return resolveRecommended(repoRoot, corpus, conflicts, targets);
  if (opts.right) return resolveRight(repoRoot, conflicts, targets, opts);
  return resolveDismiss(repoRoot, conflicts, targets, opts);
}

/** Side pick — single conflict only (picking sides in bulk is meaningless). */
async function resolveRight(
  repoRoot: string,
  conflicts: CorpusConflict[],
  targets: string[],
  opts: RunSpecConflictsResolveOptions,
): Promise<void> {
  if (opts.area) return fail('--area applies to dismissals only; pick a side on one conflict by number or area.');
  if (targets.length !== 1) return fail('--right takes exactly one conflict (picking sides in bulk is meaningless).');
  const picked = pickConflict(targets[0], conflicts, opts.right);
  if ('error' in picked) return fail(picked.error);
  if (opts.right !== picked.a && opts.right !== picked.b) {
    return fail(`--right must be one of the disputing docs: ${picked.a} or ${picked.b}.`);
  }
  const verdict: 'a' | 'b' = opts.right === picked.a ? 'a' : 'b';
  await addConflictResolution(repoRoot, buildResolution(picked, verdict, opts.note));
  const winner = verdict === 'a' ? picked.a : picked.b;
  const loser = verdict === 'a' ? picked.b : picked.a;
  p.outro(
    `Recorded: ${base(winner)} is right. ${base(loser)}’s disputed claim is suppressed at \`truecourse guard generate\`.`,
  );
}

/** Dismiss — one or many conflicts (by index list, a positional area, or --area). */
async function resolveDismiss(
  repoRoot: string,
  conflicts: CorpusConflict[],
  targets: string[],
  opts: RunSpecConflictsResolveOptions,
): Promise<void> {
  const set = collectDismissTargets(conflicts, targets, opts.area);
  if ('error' in set) return fail(set.error);
  for (const c of set) await addConflictResolution(repoRoot, buildResolution(c, 'dismissed', opts.note));
  if (set.length === 1) {
    p.outro(`Dismissed: ${base(set[0].a)} ↔ ${base(set[0].b)} is not a real conflict.`);
  } else {
    p.outro(`Dismissed ${set.length} conflicts as detector false-positives.`);
  }
}

/** Apply the verify pass's recommendation for a single conflict. */
async function resolveRecommended(
  repoRoot: string,
  corpus: CuratedCorpus,
  conflicts: CorpusConflict[],
  targets: string[],
): Promise<void> {
  if (targets.length !== 1 || !/^\d+$/.test(targets[0])) {
    return fail('--recommended applies to a single conflict by number, e.g. `spec conflicts resolve 3 --recommended`.');
  }
  const idx = Number(targets[0]) - 1;
  if (idx < 0 || idx >= conflicts.length) {
    return fail(`No conflict #${targets[0]}. Run \`spec conflicts list\` (${conflicts.length} listed).`);
  }
  const c = conflicts[idx];
  const review = reviewForConflict(corpus, c);
  if (!review) {
    return fail(
      `No recommendation for conflict #${targets[0]} — the verify pass didn’t attach one. Resolve it manually with --right or --dismiss.`,
    );
  }
  const { action, rationale, fix } = review.recommendation;
  if (action === 'fix-doc') {
    // A doc fix can't be a verdict — tell the user what to change; write nothing.
    p.log.step(`Recommendation for #${targets[0]}: fix a doc — ${rationale}`);
    if (fix) p.log.message(`  ${fix}`);
    p.outro('Edit the doc as described, then re-run `truecourse spec scan`. No verdict was recorded.');
    return;
  }
  const verdict: 'a' | 'b' | 'dismissed' = action === 'pick-a' ? 'a' : action === 'pick-b' ? 'b' : 'dismissed';
  await addConflictResolution(repoRoot, buildResolution(c, verdict, rationale));
  if (verdict === 'dismissed') {
    p.outro(`Applied recommendation for #${targets[0]}: dismissed — ${rationale}`);
  } else {
    const winner = verdict === 'a' ? c.a : c.b;
    p.outro(`Applied recommendation for #${targets[0]}: ${base(winner)} is right — ${rationale}`);
  }
}
