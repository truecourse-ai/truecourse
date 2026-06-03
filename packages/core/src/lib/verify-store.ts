/**
 * Verifier store — the drift-side mirror of `analysis-store.ts`. Same envelope
 * (per-run snapshots, a `LATEST.json` baseline, append-only history, an optional
 * diff) and the same pluggable-store seam: file-backed by default (OSS), with the
 * enterprise edition injecting a Postgres/Blob impl via `setVerifyStore`. The
 * interface is async; the file impl wraps the synchronous `fs` calls.
 *
 * <repo>/.truecourse/verifier/
 *   runs/<iso>_<short-uuid>.json   per-run snapshots
 *   LATEST.json                     materialized current verify state (diff baseline)
 *   history.json                    per-run summaries (append-only)
 *   diff.json                       active diff against LATEST (optional)
 */

import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from './atomic-write.js';
import { buildAnalysisFilename } from './analysis-store.js';
import { summarizeDrifts } from '../types/verify-snapshot.js';
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

/** Build the materialized LATEST view from a full run snapshot. */
function materializeVerifyLatest(snap: VerifyRunSnapshot, filename: string): VerifyLatest {
  return {
    head: filename,
    run: {
      id: snap.id,
      verifiedAt: snap.verifiedAt,
      branch: snap.branch,
      commitHash: snap.commitHash,
      contractsDir: snap.contractsDir,
      codeDir: snap.codeDir,
    },
    artifactCount: snap.artifactCount,
    extractedOperationCount: snap.extractedOperationCount,
    drifts: snap.drifts,
    resolverErrors: snap.resolverErrors,
    unresolvedRefs: snap.unresolvedRefs,
    summary: summarizeDrifts(snap.drifts),
  };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface WrittenVerifyRun {
  filename: string;
  snapshot: VerifyRunSnapshot;
}

/** Pluggable verify store. File-backed by default; EE injects Postgres/Blob. */
export interface VerifyStore {
  readVerifyLatest(repoPath: string): Promise<VerifyLatest | null>;
  writeVerifyLatest(repoPath: string, latest: VerifyLatest): Promise<void>;
  deleteVerifyLatest(repoPath: string): Promise<void>;
  writeVerifyRun(repoPath: string, snapshot: VerifyRunSnapshot): Promise<WrittenVerifyRun>;
  readVerifyRun(repoPath: string, filename: string): Promise<VerifyRunSnapshot | null>;
  listVerifyRuns(repoPath: string): Promise<string[]>;
  readVerifyHistory(repoPath: string): Promise<VerifyHistory>;
  appendVerifyHistory(repoPath: string, entry: VerifyHistoryEntry): Promise<void>;
  deleteVerifyRun(repoPath: string, runId: string): Promise<boolean>;
  readVerifyDiff(repoPath: string): Promise<VerifyDiff | null>;
  writeVerifyDiff(repoPath: string, diff: VerifyDiff): Promise<void>;
  deleteVerifyDiff(repoPath: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// File-backed default impl (OSS) — synchronous fs under an async surface.
// ---------------------------------------------------------------------------

const latestCache = new Map<string, { mtime: number; data: VerifyLatest }>();

class FileVerifyStore implements VerifyStore {
  async readVerifyLatest(repoPath: string): Promise<VerifyLatest | null> {
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

  async writeVerifyLatest(repoPath: string, latest: VerifyLatest): Promise<void> {
    atomicWriteJson(verifyLatestPath(repoPath), latest);
    latestCache.delete(repoPath);
  }

  async deleteVerifyLatest(repoPath: string): Promise<void> {
    try {
      fs.unlinkSync(verifyLatestPath(repoPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    latestCache.delete(repoPath);
  }

  async writeVerifyRun(repoPath: string, snapshot: VerifyRunSnapshot): Promise<WrittenVerifyRun> {
    const filename = buildVerifyRunFilename(snapshot.id, snapshot.verifiedAt);
    atomicWriteJson(verifyRunPath(repoPath, filename), snapshot);
    return { filename, snapshot };
  }

  async readVerifyRun(repoPath: string, filename: string): Promise<VerifyRunSnapshot | null> {
    const file = verifyRunPath(repoPath, filename);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyRunSnapshot;
  }

  async listVerifyRuns(repoPath: string): Promise<string[]> {
    const dir = runsDir(repoPath);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  }

  async readVerifyHistory(repoPath: string): Promise<VerifyHistory> {
    const file = verifyHistoryPath(repoPath);
    if (!fs.existsSync(file)) return { runs: [] };
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyHistory;
  }

  async appendVerifyHistory(repoPath: string, entry: VerifyHistoryEntry): Promise<void> {
    const history = await this.readVerifyHistory(repoPath);
    history.runs.push(entry);
    atomicWriteJson(verifyHistoryPath(repoPath), history);
  }

  async deleteVerifyRun(repoPath: string, runId: string): Promise<boolean> {
    const history = await this.readVerifyHistory(repoPath);
    const entry = history.runs.find((r) => r.id === runId);
    if (!entry) return false;
    try {
      fs.unlinkSync(verifyRunPath(repoPath, entry.filename));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    history.runs = history.runs.filter((r) => r.id !== runId);
    atomicWriteJson(verifyHistoryPath(repoPath), history);

    const latest = await this.readVerifyLatest(repoPath);
    if (latest && latest.head === entry.filename) {
      // History is appended oldest-first, so the last entry is the newest.
      const newest = history.runs[history.runs.length - 1];
      const snap = newest ? await this.readVerifyRun(repoPath, newest.filename) : null;
      if (snap && newest) {
        await this.writeVerifyLatest(repoPath, materializeVerifyLatest(snap, newest.filename));
      } else {
        await this.deleteVerifyLatest(repoPath);
      }
      await this.deleteVerifyDiff(repoPath); // baseline moved (or gone) — any diff is obsolete
    }
    return true;
  }

  async readVerifyDiff(repoPath: string): Promise<VerifyDiff | null> {
    const file = verifyDiffPath(repoPath);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyDiff;
  }

  async writeVerifyDiff(repoPath: string, diff: VerifyDiff): Promise<void> {
    atomicWriteJson(verifyDiffPath(repoPath), diff);
  }

  async deleteVerifyDiff(repoPath: string): Promise<void> {
    try {
      fs.unlinkSync(verifyDiffPath(repoPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Active store registry + public delegators (same names, now async).
// ---------------------------------------------------------------------------

let active: VerifyStore = new FileVerifyStore();

/** The active verify store (file-backed unless EE installed a Postgres one). */
export function getVerifyStore(): VerifyStore {
  return active;
}
/** Install a verify store (e.g. the enterprise Postgres/Blob impl). */
export function setVerifyStore(store: VerifyStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetVerifyStore(): void {
  active = new FileVerifyStore();
}

export const readVerifyLatest = (repoPath: string): Promise<VerifyLatest | null> =>
  active.readVerifyLatest(repoPath);
export const writeVerifyLatest = (repoPath: string, latest: VerifyLatest): Promise<void> =>
  active.writeVerifyLatest(repoPath, latest);
export const deleteVerifyLatest = (repoPath: string): Promise<void> =>
  active.deleteVerifyLatest(repoPath);
export const writeVerifyRun = (repoPath: string, snapshot: VerifyRunSnapshot): Promise<WrittenVerifyRun> =>
  active.writeVerifyRun(repoPath, snapshot);
export const readVerifyRun = (repoPath: string, filename: string): Promise<VerifyRunSnapshot | null> =>
  active.readVerifyRun(repoPath, filename);
export const listVerifyRuns = (repoPath: string): Promise<string[]> =>
  active.listVerifyRuns(repoPath);
export const readVerifyHistory = (repoPath: string): Promise<VerifyHistory> =>
  active.readVerifyHistory(repoPath);
export const appendVerifyHistory = (repoPath: string, entry: VerifyHistoryEntry): Promise<void> =>
  active.appendVerifyHistory(repoPath, entry);
export const deleteVerifyRun = (repoPath: string, runId: string): Promise<boolean> =>
  active.deleteVerifyRun(repoPath, runId);
export const readVerifyDiff = (repoPath: string): Promise<VerifyDiff | null> =>
  active.readVerifyDiff(repoPath);
export const writeVerifyDiff = (repoPath: string, diff: VerifyDiff): Promise<void> =>
  active.writeVerifyDiff(repoPath, diff);
export const deleteVerifyDiff = (repoPath: string): Promise<void> =>
  active.deleteVerifyDiff(repoPath);

/** Test-only: clear the LATEST cache between fixtures. */
export function clearVerifyLatestCache(): void {
  latestCache.clear();
}
