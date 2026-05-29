/**
 * Verifier store — the drift-side mirror of `analysis-store.ts`. Same envelope
 * (per-run snapshots, a committable `LATEST.json` baseline, append-only
 * history, an optional diff), same atomic-write + mtime-cache conventions, but
 * rooted in its own subdir so its `LATEST.json` doesn't collide with analyze's.
 *
 * <repo>/.truecourse/verifier/
 *   runs/<iso>_<short-uuid>.json   per-run snapshots
 *   LATEST.json                     materialized current verify state (committable, diff baseline)
 *   history.json                    per-run summaries (append-only)
 *   diff.json                       active diff against LATEST (optional)
 *
 * Consumers pass `repoPath` (the repo root, not the `.truecourse` dir).
 */

import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from './atomic-write.js';
import { buildAnalysisFilename } from './analysis-store.js';
import type {
  VerifyDiff,
  VerifyHistory,
  VerifyHistoryEntry,
  VerifyLatest,
  VerifyRunSnapshot,
} from '../types/verify-snapshot.js';

const TRUECOURSE_DIR = '.truecourse';
const VERIFIER_DIR = 'verifier';
const RUNS_DIR = 'runs';
const LATEST_FILE = 'LATEST.json';
const HISTORY_FILE = 'history.json';
const DIFF_FILE = 'diff.json';

function verifierDir(repoPath: string): string {
  return path.join(repoPath, TRUECOURSE_DIR, VERIFIER_DIR);
}
function runsDir(repoPath: string): string {
  return path.join(verifierDir(repoPath), RUNS_DIR);
}
export function verifyRunPath(repoPath: string, filename: string): string {
  return path.join(runsDir(repoPath), filename);
}
export function verifyLatestPath(repoPath: string): string {
  return path.join(verifierDir(repoPath), LATEST_FILE);
}
export function verifyHistoryPath(repoPath: string): string {
  return path.join(verifierDir(repoPath), HISTORY_FILE);
}
export function verifyDiffPath(repoPath: string): string {
  return path.join(verifierDir(repoPath), DIFF_FILE);
}

/** Filename for a new run snapshot — shares analyze's sortable ISO+uuid format. */
export function buildVerifyRunFilename(runId: string, verifiedAt: string): string {
  return buildAnalysisFilename(runId, verifiedAt);
}

// ---------------------------------------------------------------------------
// LATEST.json — mtime-keyed in-memory cache
// ---------------------------------------------------------------------------

const latestCache = new Map<string, { mtime: number; data: VerifyLatest }>();

export function readVerifyLatest(repoPath: string): VerifyLatest | null {
  const file = verifyLatestPath(repoPath);
  let mtime: number;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      latestCache.delete(repoPath);
      return null;
    }
    throw err;
  }
  const cached = latestCache.get(repoPath);
  if (cached && cached.mtime === mtime) return cached.data;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyLatest;
  latestCache.set(repoPath, { mtime, data });
  return data;
}

export function writeVerifyLatest(repoPath: string, latest: VerifyLatest): void {
  atomicWriteJson(verifyLatestPath(repoPath), latest);
  latestCache.delete(repoPath);
}

export function deleteVerifyLatest(repoPath: string): void {
  try {
    fs.unlinkSync(verifyLatestPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  latestCache.delete(repoPath);
}

// ---------------------------------------------------------------------------
// Per-run snapshots
// ---------------------------------------------------------------------------

export interface WrittenVerifyRun {
  filename: string;
  snapshot: VerifyRunSnapshot;
}

export function writeVerifyRun(repoPath: string, snapshot: VerifyRunSnapshot): WrittenVerifyRun {
  const filename = buildVerifyRunFilename(snapshot.id, snapshot.verifiedAt);
  atomicWriteJson(verifyRunPath(repoPath, filename), snapshot);
  return { filename, snapshot };
}

export function readVerifyRun(repoPath: string, filename: string): VerifyRunSnapshot | null {
  const file = verifyRunPath(repoPath, filename);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyRunSnapshot;
}

/** List run filenames, oldest first (ISO prefix ⇒ chronological). */
export function listVerifyRuns(repoPath: string): string[] {
  const dir = runsDir(repoPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
}

// ---------------------------------------------------------------------------
// history.json
// ---------------------------------------------------------------------------

export function readVerifyHistory(repoPath: string): VerifyHistory {
  const file = verifyHistoryPath(repoPath);
  if (!fs.existsSync(file)) return { runs: [] };
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyHistory;
}

export function appendVerifyHistory(repoPath: string, entry: VerifyHistoryEntry): void {
  const history = readVerifyHistory(repoPath);
  history.runs.push(entry);
  atomicWriteJson(verifyHistoryPath(repoPath), history);
}

// ---------------------------------------------------------------------------
// diff.json
// ---------------------------------------------------------------------------

export function readVerifyDiff(repoPath: string): VerifyDiff | null {
  const file = verifyDiffPath(repoPath);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyDiff;
}

export function writeVerifyDiff(repoPath: string, diff: VerifyDiff): void {
  atomicWriteJson(verifyDiffPath(repoPath), diff);
}

export function deleteVerifyDiff(repoPath: string): void {
  try {
    fs.unlinkSync(verifyDiffPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Test-only: clear the LATEST cache between fixtures. */
export function clearVerifyLatestCache(): void {
  latestCache.clear();
}
