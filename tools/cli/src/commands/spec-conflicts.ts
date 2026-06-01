/**
 * `truecourse spec conflicts <sub>` — agent-friendly conflict surface.
 *
 *   list   [--decided] [--all]              list open conflicts
 *   show   <id>                             full detail for one
 *   pick   <id> <candidateIndex> [--note]   write a `pick` decision
 *   custom <id> --text "..."                write a `custom` decision
 *   revoke <id>                             remove a previously-saved decision
 *
 * Write commands persist to decisions.json and refresh the scan-state so a
 * subsequent `list` reflects the change.
 */

import * as p from '@clack/prompts';
import path from 'node:path';
import { candidateFingerprint } from '@truecourse/spec-consolidator';
import type { Conflict } from '@truecourse/spec-consolidator';
import { StepTracker } from '@truecourse/core/progress';
import {
  scanInProcess,
  SCAN_STEPS,
  upsertDecision,
  revokeDecision as revokeDecisionInProcess,
} from '@truecourse/core/commands/spec-in-process';
import { readScanState } from '@truecourse/spec-consolidator';
import { createStdoutStepRenderer } from '../lib/stdout-step-renderer.js';

export interface RunSpecConflictsOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecConflictsOptions): string => opts.cwd ?? process.cwd();

// ---------------------------------------------------------------------------
// Shared: load the current scan-state, scanning if necessary
// ---------------------------------------------------------------------------

interface LoadedScan {
  open: Conflict[];
  decided: Array<{ conflict: Conflict; decision: unknown }>;
}

async function loadScan(root: string): Promise<LoadedScan> {
  const cached = readScanState(root);
  if (cached) {
    return {
      open: cached.openConflicts as Conflict[],
      decided: cached.decidedConflicts as Array<{ conflict: Conflict; decision: unknown }>,
    };
  }
  // No cache — run a scan first.
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, SCAN_STEPS.map((s) => ({ ...s })));
  try {
    const { consolidate } = await scanInProcess(root, { tracker });
    renderer.dispose();
    return {
      open: consolidate.merge.openConflicts,
      decided: consolidate.merge.decidedConflicts.map((d) => ({
        conflict: d.conflict,
        decision: d.decision,
      })),
    };
  } catch (e) {
    renderer.dispose();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function runSpecConflictsList(
  opts: RunSpecConflictsOptions & { decided?: boolean; all?: boolean } = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root);
  const open = scan.open.map(serializeConflict);
  const decided = scan.decided.map((d) => ({
    conflict: serializeConflict(d.conflict),
    decision: d.decision,
  }));

  p.intro('Conflicts');
  const which = opts.all ? 'all' : opts.decided ? 'decided' : 'open';
  const list = opts.all ? [...open, ...decided.map((d) => d.conflict)] : opts.decided ? decided.map((d) => d.conflict) : open;
  p.log.step(`${list.length} ${which} conflicts`);
  for (const c of list) {
    p.log.message(`  • ${c.id}  [${c.topic}] ${c.subject}  (${c.candidates.length} candidates)`);
  }
  p.outro('Use `truecourse spec conflicts show <id>` for full detail.');
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export async function runSpecConflictsShow(
  conflictId: string,
  opts: RunSpecConflictsOptions & { diff?: boolean } = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root);
  const conflict =
    scan.open.find((c) => c.id === conflictId) ??
    scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) {
    p.cancel(`Conflict ${conflictId} not found.`);
    process.exit(1);
  }
  p.intro(`Conflict ${conflict.id} — ${conflict.subject}`);
  p.log.step(`topic: ${conflict.topic}`);
  if (conflict.explanation) p.log.message(conflict.explanation);
  p.log.step(`${conflict.candidates.length} candidates (default-pick: ${conflict.defaultPick})`);
  for (const cand of conflict.candidates) {
    const meta = cand.claim.metadata;
    p.log.message(
      `  [${cand.index}] ${cand.weight}  ${cand.claim.provenance.file}:${cand.claim.provenance.line}` +
        `  kind=${meta.docKind}  status=${meta.status ?? '-'}`,
    );
  }
  if (opts.diff) {
    const diffs = computeFieldDifferences(conflict);
    if (diffs.length === 0) {
      p.log.step('field differences: none — candidates structurally identical');
    } else {
      p.log.step(`field differences: ${diffs.length}`);
      for (const d of diffs.slice(0, 12)) {
        p.log.message(
          `  ${d.path}  [${d.fromIndex}] ${shortJson(d.fromValue)}  ·  [${d.toIndex}] ${shortJson(d.toValue)}`,
        );
      }
      if (diffs.length > 12) p.log.message(`  … and ${diffs.length - 12} more`);
    }
  }
  p.outro('');
}

// ---------------------------------------------------------------------------
// pick / custom / revoke
// ---------------------------------------------------------------------------

export async function runSpecConflictsPick(
  conflictId: string,
  candidateIndex: number,
  opts: RunSpecConflictsOptions & { note?: string } = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root);
  const conflict = scan.open.find((c) => c.id === conflictId) ?? scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) return failNotFound(conflictId);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= conflict.candidates.length) {
    return fail(
      `candidateIndex ${candidateIndex} out of range (0..${conflict.candidates.length - 1})`,
    );
  }
  upsertDecision(root, {
    conflictId,
    resolution: { kind: 'pick', candidateIndex },
    candidateFingerprint: candidateFingerprint(conflict),
    note: opts.note,
  });
  await refreshScan(root);
  emitOk(`Picked candidate ${candidateIndex} on ${conflictId.slice(0, 12)}…`);
}

export async function runSpecConflictsCustom(
  conflictId: string,
  text: string,
  opts: RunSpecConflictsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root);
  const conflict = scan.open.find((c) => c.id === conflictId) ?? scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) return failNotFound(conflictId);
  if (!text || !text.trim()) {
    return fail('--text must be a non-empty string');
  }
  upsertDecision(root, {
    conflictId,
    resolution: { kind: 'custom', content: text },
    candidateFingerprint: candidateFingerprint(conflict),
  });
  await refreshScan(root);
  emitOk(`Wrote custom answer for ${conflictId.slice(0, 12)}…`);
}

export async function runSpecConflictsRevoke(
  conflictId: string,
  opts: RunSpecConflictsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  revokeDecisionInProcess(root, conflictId);
  await refreshScan(root);
  emitOk(`Revoked decision for ${conflictId.slice(0, 12)}…`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function serializeConflict(c: Conflict): Conflict & { candidateFingerprint: string } {
  return {
    ...c,
    candidateFingerprint: candidateFingerprint(c),
  };
}

async function refreshScan(root: string): Promise<void> {
  // Re-merge so the next read reflects the change.
  await scanInProcess(root, {});
}

function emitOk(msg: string): void {
  p.outro(msg);
}

function fail(msg: string): never {
  p.cancel(msg);
  process.exit(1);
}

function failNotFound(id: string): never {
  return fail(`conflict ${id} not found`);
}

// Avoid an `import path` removal at build time when this file otherwise
// doesn't need it.
void path;

// ---------------------------------------------------------------------------
// Field-level diff — opt-in via `--diff`. Useful for agents that want a
// precise list of which JSON paths in a candidate's structured content
// differ from each other candidate's. Pure structural diff; no semantic
// interpretation.
// ---------------------------------------------------------------------------

interface FieldDifference {
  /** Dot-joined path into `claim.content`. `(root)` when scalars differ. */
  path: string;
  /** Pair this diff is computed between. */
  fromIndex: number;
  toIndex: number;
  fromValue: unknown;
  toValue: unknown;
}

function computeFieldDifferences(conflict: Conflict): FieldDifference[] {
  const out: FieldDifference[] = [];
  for (let i = 0; i < conflict.candidates.length; i++) {
    for (let j = i + 1; j < conflict.candidates.length; j++) {
      const a = conflict.candidates[i].claim.content;
      const b = conflict.candidates[j].claim.content;
      for (const path of diffPaths(a, b)) {
        out.push({
          path,
          fromIndex: i,
          toIndex: j,
          fromValue: getPath(a, path),
          toValue: getPath(b, path),
        });
      }
    }
  }
  return out;
}

/** Return all leaf paths where `a` and `b` disagree. Missing key counts as a diff. */
function diffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  const out: string[] = [];
  const aIsObj = a !== null && typeof a === 'object' && !Array.isArray(a);
  const bIsObj = b !== null && typeof b === 'object' && !Array.isArray(b);
  if (aIsObj && bIsObj) {
    const keys = new Set([
      ...Object.keys(a as object),
      ...Object.keys(b as object),
    ]);
    for (const k of keys) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      out.push(
        ...diffPaths(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          childPath,
        ),
      );
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push(prefix || '(root)');
  }
  return out;
}

function getPath(value: unknown, path: string): unknown {
  if (path === '(root)' || !path) return value;
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function shortJson(value: unknown): string {
  if (value === undefined) return '∅';
  const s = JSON.stringify(value);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}
