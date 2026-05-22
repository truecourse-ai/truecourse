/**
 * `truecourse spec conflicts <sub>` — agent-friendly conflict surface.
 *
 *   list   [--json] [--decided] [--all]    list open conflicts
 *   show   <id> [--json]                    full detail for one
 *   pick   <id> <candidateIndex> [--note]   write a `pick` decision
 *   custom <id> --text "..."                write a `custom` decision
 *   revoke <id>                             remove a previously-saved decision
 *
 * Every read command honors `--json` for machine consumption. Write
 * commands persist to decisions.json and refresh the scan-state so a
 * subsequent `list --json` reflects the change.
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
  json?: boolean;
}

const repoRoot = (opts: RunSpecConflictsOptions): string => opts.cwd ?? process.cwd();

// ---------------------------------------------------------------------------
// Shared: load the current scan-state, scanning if necessary
// ---------------------------------------------------------------------------

interface LoadedScan {
  open: Conflict[];
  decided: Array<{ conflict: Conflict; decision: unknown }>;
}

async function loadScan(root: string, json: boolean): Promise<LoadedScan> {
  const cached = readScanState(root);
  if (cached) {
    return {
      open: cached.openConflicts as Conflict[],
      decided: cached.decidedConflicts as Array<{ conflict: Conflict; decision: unknown }>,
    };
  }
  // No cache — run a scan first. Suppress clack noise when JSON is requested.
  if (json) {
    const { consolidate } = await scanInProcess(root, {});
    return {
      open: consolidate.merge.openConflicts,
      decided: consolidate.merge.decidedConflicts.map((d) => ({
        conflict: d.conflict,
        decision: d.decision,
      })),
    };
  }
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
  const scan = await loadScan(root, !!opts.json);
  const open = scan.open.map(serializeConflict);
  const decided = scan.decided.map((d) => ({
    conflict: serializeConflict(d.conflict),
    decision: d.decision,
  }));

  if (opts.json) {
    const payload = opts.all
      ? { openConflicts: open, decidedConflicts: decided }
      : opts.decided
        ? { decidedConflicts: decided }
        : { openConflicts: open };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  p.intro('Conflicts');
  const which = opts.all ? 'all' : opts.decided ? 'decided' : 'open';
  const list = opts.all ? [...open, ...decided.map((d) => d.conflict)] : opts.decided ? decided.map((d) => d.conflict) : open;
  p.log.step(`${list.length} ${which} conflicts`);
  for (const c of list) {
    p.log.message(`  • ${c.id.slice(0, 12)}…  [${c.topic}] ${c.subject}  (${c.candidates.length} candidates)`);
  }
  p.outro('Use `truecourse spec conflicts show <id> --json` for full detail.');
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export async function runSpecConflictsShow(
  conflictId: string,
  opts: RunSpecConflictsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root, !!opts.json);
  const conflict =
    scan.open.find((c) => c.id === conflictId) ??
    scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: `conflict ${conflictId} not found` }, null, 2) + '\n');
      process.exit(1);
    }
    p.cancel(`Conflict ${conflictId} not found.`);
    process.exit(1);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(serializeConflict(conflict), null, 2) + '\n');
    return;
  }
  p.intro(`Conflict ${conflict.id.slice(0, 12)}… — ${conflict.subject}`);
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
  const scan = await loadScan(root, !!opts.json);
  const conflict = scan.open.find((c) => c.id === conflictId) ?? scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) return failNotFound(conflictId, !!opts.json);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= conflict.candidates.length) {
    return fail(
      `candidateIndex ${candidateIndex} out of range (0..${conflict.candidates.length - 1})`,
      !!opts.json,
    );
  }
  upsertDecision(root, {
    conflictId,
    resolution: { kind: 'pick', candidateIndex },
    candidateFingerprint: candidateFingerprint(conflict),
    note: opts.note,
  });
  await refreshScan(root, !!opts.json);
  emitOk(`Picked candidate ${candidateIndex} on ${conflictId.slice(0, 12)}…`, !!opts.json, {
    conflictId,
    resolution: { kind: 'pick', candidateIndex },
  });
}

export async function runSpecConflictsCustom(
  conflictId: string,
  text: string,
  opts: RunSpecConflictsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  const scan = await loadScan(root, !!opts.json);
  const conflict = scan.open.find((c) => c.id === conflictId) ?? scan.decided.find((d) => d.conflict.id === conflictId)?.conflict;
  if (!conflict) return failNotFound(conflictId, !!opts.json);
  if (!text || !text.trim()) {
    return fail('--text must be a non-empty string', !!opts.json);
  }
  upsertDecision(root, {
    conflictId,
    resolution: { kind: 'custom', content: text },
    candidateFingerprint: candidateFingerprint(conflict),
  });
  await refreshScan(root, !!opts.json);
  emitOk(`Wrote custom answer for ${conflictId.slice(0, 12)}…`, !!opts.json, {
    conflictId,
    resolution: { kind: 'custom' },
  });
}

export async function runSpecConflictsRevoke(
  conflictId: string,
  opts: RunSpecConflictsOptions = {},
): Promise<void> {
  const root = repoRoot(opts);
  revokeDecisionInProcess(root, conflictId);
  await refreshScan(root, !!opts.json);
  emitOk(`Revoked decision for ${conflictId.slice(0, 12)}…`, !!opts.json, { conflictId });
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

async function refreshScan(root: string, json: boolean): Promise<void> {
  // Re-merge so the next read reflects the change. Suppress UI noise
  // when JSON mode is active.
  if (json) {
    await scanInProcess(root, {});
    return;
  }
  await scanInProcess(root, {});
}

function emitOk(msg: string, json: boolean, payload: object): void {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
    return;
  }
  p.outro(msg);
}

function fail(msg: string, json: boolean): never {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
    process.exit(1);
  }
  p.cancel(msg);
  process.exit(1);
}

function failNotFound(id: string, json: boolean): never {
  return fail(`conflict ${id} not found`, json);
}

// Avoid an `import path` removal at build time when this file otherwise
// doesn't need it.
void path;
