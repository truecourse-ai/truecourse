import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from './atomic-write.js';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  History,
  HistoryEntry,
  LatestSnapshot,
} from '../types/snapshot.js';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
//
// <repo>/.truecourse/
//   analyses/<iso>_<short-uuid>.json   per-analysis snapshots
//   LATEST.json                         materialized current-state view
//   history.json                        summaries (append-only)
//   diff.json                           active diff against LATEST (optional)
//
// Consumers pass `repoPath` (the repo root, not the `.truecourse` dir).
// ---------------------------------------------------------------------------

const TRUECOURSE_DIR = '.truecourse';
const ANALYSES_DIR = 'analyses';
const LATEST_FILE = 'LATEST.json';
const HISTORY_FILE = 'history.json';
const DIFF_FILE = 'diff.json';

function storeDir(repoPath: string): string {
  return path.join(repoPath, TRUECOURSE_DIR);
}

function analysesDir(repoPath: string): string {
  return path.join(storeDir(repoPath), ANALYSES_DIR);
}

export function analysisFilePath(repoPath: string, filename: string): string {
  return path.join(analysesDir(repoPath), filename);
}

export function latestPath(repoPath: string): string {
  return path.join(storeDir(repoPath), LATEST_FILE);
}

export function historyPath(repoPath: string): string {
  return path.join(storeDir(repoPath), HISTORY_FILE);
}

export function diffPath(repoPath: string): string {
  return path.join(storeDir(repoPath), DIFF_FILE);
}

// ---------------------------------------------------------------------------
// Filename for a new analysis snapshot
// ---------------------------------------------------------------------------

/**
 * Build the filename for a new analysis snapshot. Format:
 *   `YYYY-MM-DDTHH-MM-SSZ_<8-char-uuid>.json`
 *
 * Sortable lexicographically ⇒ sortable chronologically. The 8-char suffix
 * guards against two analyses starting in the same second on the same repo
 * (vanishingly rare but costs nothing to prevent).
 */
export function buildAnalysisFilename(analysisId: string, createdAt: string): string {
  const iso = createdAt
    .replace(/[:.]/g, '-')    // "2026-04-17T14:23:45.123Z" → "2026-04-17T14-23-45-123Z"
    .replace(/-\d{3}Z$/, 'Z'); // drop millis for the filename
  const shortId = analysisId.replace(/-/g, '').slice(0, 8);
  return `${iso}_${shortId}.json`;
}

// ---------------------------------------------------------------------------
// LATEST.json — mtime-keyed in-memory cache
// ---------------------------------------------------------------------------

const latestCache = new Map<string, { mtime: number; data: LatestSnapshot }>();

/**
 * Read `LATEST.json` for `repoPath`, caching by mtime. Subsequent calls only
 * do a `stat` (sub-ms) unless the file has changed — cheap enough to run on
 * every HTTP request.
 */
export function readLatest(repoPath: string): LatestSnapshot | null {
  const file = latestPath(repoPath);
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
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as LatestSnapshot;
  latestCache.set(repoPath, { mtime, data });
  return data;
}

export function writeLatest(repoPath: string, latest: LatestSnapshot): void {
  atomicWriteJson(latestPath(repoPath), latest);
  latestCache.delete(repoPath);             // force re-read on next access
}

export function deleteLatest(repoPath: string): void {
  try {
    fs.unlinkSync(latestPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  latestCache.delete(repoPath);
}

// ---------------------------------------------------------------------------
// Per-analysis snapshots
// ---------------------------------------------------------------------------

export interface WrittenAnalysis {
  filename: string;
  snapshot: AnalysisSnapshot;
}

/** Write a per-analysis snapshot. Returns the filename it was stored as. */
export function writeAnalysis(repoPath: string, snapshot: AnalysisSnapshot): WrittenAnalysis {
  const filename = buildAnalysisFilename(snapshot.id, snapshot.createdAt);
  atomicWriteJson(analysisFilePath(repoPath, filename), snapshot);
  return { filename, snapshot };
}

export function readAnalysis(repoPath: string, filename: string): AnalysisSnapshot | null {
  const file = analysisFilePath(repoPath, filename);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as AnalysisSnapshot;
}

/** List analysis filenames, oldest first (chronological). */
export function listAnalyses(repoPath: string): string[] {
  const dir = analysesDir(repoPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();                              // ISO prefix makes lexical sort chronological
}

/** Find the filename for a given analysis id by scanning newest → oldest. */
export function findAnalysisFilename(repoPath: string, analysisId: string): string | null {
  for (const name of listAnalyses(repoPath).reverse()) {
    const snap = readAnalysis(repoPath, name);
    if (snap?.id === analysisId) return name;
  }
  return null;
}

export function deleteAnalysis(repoPath: string, filename: string): void {
  try {
    fs.unlinkSync(analysisFilePath(repoPath, filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// ---------------------------------------------------------------------------
// history.json
// ---------------------------------------------------------------------------

export function readHistory(repoPath: string): History {
  const file = historyPath(repoPath);
  if (!fs.existsSync(file)) return { analyses: [] };
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as History;
}

export function appendHistory(repoPath: string, entry: HistoryEntry): void {
  const history = readHistory(repoPath);
  history.analyses.push(entry);
  atomicWriteJson(historyPath(repoPath), history);
}

export function removeFromHistory(repoPath: string, analysisId: string): void {
  const history = readHistory(repoPath);
  const next = history.analyses.filter((a) => a.id !== analysisId);
  if (next.length === history.analyses.length) return;   // nothing to do
  atomicWriteJson(historyPath(repoPath), { analyses: next });
}

// ---------------------------------------------------------------------------
// diff.json
// ---------------------------------------------------------------------------

export function readDiff(repoPath: string): DiffSnapshot | null {
  const file = diffPath(repoPath);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as DiffSnapshot;
}

export function writeDiff(repoPath: string, diff: DiffSnapshot): void {
  atomicWriteJson(diffPath(repoPath), diff);
}

export function deleteDiff(repoPath: string): void {
  try {
    fs.unlinkSync(diffPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// ---------------------------------------------------------------------------
// Test-only: invalidate cache
// ---------------------------------------------------------------------------

/** Clear the LATEST.json in-memory cache for all repos. Tests call this
 *  between setUp/tearDown; production code relies on `writeLatest` invalidation. */
export function clearLatestCache(): void {
  latestCache.clear();
}
