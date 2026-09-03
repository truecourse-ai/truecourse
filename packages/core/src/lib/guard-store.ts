/**
 * Guard store — the pluggable persistence seam for the guard subsystem, the guard
 * analogue of `verify-store.ts` / `contract-store.ts` / `spec-store.ts`. File-backed
 * by default (OSS — the `<repo>/.truecourse/guard/` run store plus the committable
 * `<repo>/.truecourse/scenarios/` corpus, exactly where the guard-runner writers
 * put them); the enterprise edition injects a Postgres/Blob impl via `setGuardStore`.
 *
 * The interface is async; the file impl wraps the synchronous guard-runner free
 * functions (`@truecourse/guard-runner` `store.ts` / `manifest.ts` / `decisions.ts`
 * / `scenario-loader.ts`) and adds the thin fs readers guard-runner has no free
 * function for (a run snapshot read, evidence reads, the scenario-file browser).
 *
 * Layout (file impl):
 *   <repo>/.truecourse/guard/
 *     LATEST.json / runs/<runId>.json / history.json / result.json
 *     evidence/<runId>/<scenarioId>/…
 *   <repo>/.truecourse/scenarios/
 *     recipe.json / manifest.json / decisions.json / <area>/*.yaml
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  appendGuardHistory as fileAppendGuardHistory,
  evidenceRelPath,
  evidenceRunDir,
  evidenceScenarioDir,
  guardDir,
  guardRunPath,
  loadScenarios as fileLoadScenarios,
  readGuardDecisions as fileReadGuardDecisions,
  readGuardHistory as fileReadGuardHistory,
  readGuardLatest as fileReadGuardLatest,
  readGuardResult as fileReadGuardResult,
  readManifest as fileReadManifest,
  recipePath,
  scenariosDir,
  walkScenarioRelFiles,
  writeGuardDecisions as fileWriteGuardDecisions,
  writeGuardLatest as fileWriteGuardLatest,
  writeGuardResult as fileWriteGuardResult,
  writeGuardRun as fileWriteGuardRun,
  guardDecisionsPath,
  type LoadedScenarios,
} from '@truecourse/guard-runner';
import {
  GuardLatestSchema,
  type GuardDecisions,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardManifest,
} from '@truecourse/shared';
import type { RepoRef } from './contract-store.js';

// `RepoRef` is declared in contract-store.ts (the canonical home for store scope
// handles) and re-exported here so guard callers share one definition — the same
// convention spec-store.ts follows.
export type { RepoRef } from './contract-store.js';

/** How wide a history read is: the baseline trend (default) or every stored run. */
export interface GuardHistoryReadOptions {
  all?: boolean;
}

/** A written run snapshot — the runId it is keyed by plus the stored state. */
export interface WrittenGuardRun {
  runId: string;
  latest: GuardLatest;
}

/** Result of snapshotting the on-disk scenario corpus (the count is informational). */
export interface SaveScenariosResult {
  fileCount: number;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Pluggable guard store. File-backed by default; EE injects Postgres/Blob. */
export interface GuardStore {
  /**
   * True when keyed by an on-disk working-tree path (OSS file store); false for
   * the hosted store, which keys by a stable repo identity. Lets callers choose
   * the right key (repoRoot vs repoKey) and treat the corpus as read-in-place.
   */
  readonly materializesInPlace: boolean;

  // --- Run state ------------------------------------------------------------
  readGuardLatest(repoPath: string): Promise<GuardLatest | null>;
  writeGuardLatest(repoPath: string, latest: GuardLatest): Promise<void>;
  /** Persist a per-run snapshot; returns its runId key + the stored state. */
  writeGuardRun(repoPath: string, latest: GuardLatest): Promise<WrittenGuardRun>;
  /** Read + validate a past run snapshot by runId, or `null` (unsafe id / absent). */
  readGuardRun(repoPath: string, runId: string): Promise<GuardLatest | null>;
  /** Stored run for an exact commit (base-run reuse + webhook-redelivery dedupe), or null. */
  readGuardRunForCommit(repoPath: string, commitSha: string): Promise<GuardLatest | null>;
  /**
   * The run trend: the repo's baseline runs, oldest-first. `all` widens it to
   * EVERY stored run — a pull request's head runs included — for a run list.
   * The file store holds one history and ignores the option.
   */
  readGuardHistory(repoPath: string, opts?: GuardHistoryReadOptions): Promise<GuardHistory>;
  appendGuardHistory(repoPath: string, entry: GuardHistoryEntry): Promise<void>;
  /**
   * The `guard generate` report. EE: `commitSha` reads that commit's report;
   * omit for the newest stored one. The file impl always reads the live store.
   */
  readGuardResult(repoKey: string, commitSha?: string): Promise<GuardGenerateReport | null>;
  /**
   * Persist a generate report for `ref` (EE keys by commit; file impl ignores it).
   * `baseline` marks a DEFAULT-BRANCH generate — the one the repo-level views
   * anchor on (see {@link GuardStore.readGuardBaselineCommit}); a PR head's
   * regenerate never sets it.
   */
  writeGuardResult(
    ref: RepoRef,
    report: GuardGenerateReport,
    opts?: { baseline?: boolean },
  ): Promise<void>;
  /**
   * The commit of the newest generate report written as a baseline, or `null`
   * when none was. The hosted repo-level guard views fall back to it when the
   * repo has no analyze baseline to anchor on; the file impl has no commits to
   * anchor (its tree IS the baseline) and always answers `null`.
   */
  readGuardBaselineCommit(repoKey: string): Promise<string | null>;

  // --- Evidence -------------------------------------------------------------
  /**
   * Write a map of evidence `{ file → content }` under a run's scenario dir and
   * return the repo-relative evidence pointer (`evidenceRelPath`). Each file name
   * must be a plain segment (no separators / `..`). A `Buffer` value is a binary
   * artifact (a screenshot, the session video) and is stored byte-exact.
   */
  writeGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    files: Record<string, string | Buffer>,
  ): Promise<string>;
  /** One evidence file for a run's scenario, or `null` (unsafe segment / absent). */
  readGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    file: string,
  ): Promise<string | null>;
  /**
   * One evidence file addressed by its repo-relative evidence DIRECTORY (a birth
   * finding's `evidencePath`), or `null`. The read is confined to the guard
   * evidence root — a `../`-laced `evidenceDir` can never escape it.
   */
  readGuardEvidenceAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<string | null>;
  /**
   * The file NAMES a scenario's evidence bundle holds, addressed by the same
   * repo-relative evidence DIRECTORY `readGuardEvidenceAt` takes. Sorted, and empty
   * for an unsafe dir or one that was never written. The one way to discover the
   * artifacts nothing points at — a browser run's `step-<n>.png` / `session.webm`
   * are named by no transcript field.
   */
  listGuardEvidenceAt(repoPath: string, evidenceDir: string): Promise<string[]>;
  /**
   * One evidence file's raw BYTES, addressed like `readGuardEvidenceAt`. The binary
   * sibling of that text read: a screenshot or a video decoded as UTF-8 is a
   * corrupted file, so the visual artifacts are read through here.
   */
  readGuardEvidenceBytesAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<Buffer | null>;
  /**
   * Persist a BIRTH-finding's evidence for a generate result. A birth run is
   * `persist: false`, so it never creates a run row — its transcripts attach to the
   * generate report (`ref`'s commit) instead, resolved by `readGuardEvidenceAt`'s
   * fallback. The OSS file store is a no-op: the generator already wrote the
   * transcript into the working tree, where `readGuardEvidenceAt` reads it. `scenarioSeg`
   * is the finding's already-sanitized evidencePath basename (re-sanitized defensively);
   * file names must be plain (no separators / `..`).
   */
  writeGuardResultEvidence(
    ref: RepoRef,
    scenarioSeg: string,
    files: Record<string, string | Buffer>,
  ): Promise<void>;

  // --- Scenario corpus ------------------------------------------------------
  // Keyed like the contract corpus: saves are per `RepoRef` (repo + commit; the
  // EE impl keys rows by it and rejects an empty commit), commit-optional reads
  // fall back to the newest stored set. The file impl maps `repoKey` to the repo
  // path and ignores the commit — OSS reads the live working tree, which IS latest.
  /** Snapshot the on-disk scenario tree at `sourceDir` for `ref` (file impl:
   *  the tree is already in place, so this reports the count without copying). */
  saveScenarios(ref: RepoRef, sourceDir: string): Promise<SaveScenariosResult>;
  /** That commit's committed scenarios, parsed (EE: exact set — no fallback). */
  loadScenarios(ref: RepoRef): Promise<LoadedScenarios>;
  readManifest(repoKey: string, commitSha?: string): Promise<GuardManifest | null>;
  /** Raw `recipe.json` content, or `null` when absent. */
  readRecipeRaw(repoKey: string, commitSha?: string): Promise<string | null>;
  /** Repo-relative posix paths of every committed scenario YAML (sorted). */
  listScenarioFiles(repoKey: string, commitSha?: string): Promise<string[]>;
  /** One scenario YAML's content by its repo-relative path, or `null`. */
  readScenarioFile(repoKey: string, relPath: string, commitSha?: string): Promise<string | null>;

  // --- Setup bundle ---------------------------------------------------------
  // What `guard setup` leaves behind (the settle spine, findings, recipe,
  // dependency catalog, seed script) as `{ repoRelativePath: content }`. Keyed
  // like the scenario corpus: saves per `RepoRef` (the hosted store rejects an
  // empty commit), commit-optional reads fall back to the newest stored bundle.
  // OSS needs neither side — the files ARE the working tree.
  /** Snapshot setup's files for `ref` (file impl: no-op). */
  saveGuardSetupBundle(ref: RepoRef, files: Record<string, string>): Promise<void>;
  /** That commit's bundle, else the newest stored one; `null` when there is none
   *  (always `null` for the file impl). */
  loadGuardSetupBundle(
    repoKey: string,
    commitSha?: string,
  ): Promise<Record<string, string> | null>;

  // --- Decisions ------------------------------------------------------------
  // `scope` (optional) selects a PR-scoped overlay in EE (the `_pr/<n>` sentinel);
  // omitted → the repo-scoped decisions file. The file store has no overlay
  // dimension, so a PR scope fails loud (mirrors FileSpecStore).
  readGuardDecisions(repoPath: string, scope?: string): Promise<GuardDecisions>;
  writeGuardDecisions(repoPath: string, decisions: GuardDecisions, scope?: string): Promise<void>;
  deleteGuardDecisions(repoPath: string, scope?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Run ids, evidence filenames, scenario-dir names — no separators, no `..`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Resolve a repo-relative evidence directory INSIDE the guard evidence root, or
 * `null` when it points anywhere else. The one confinement every dir-addressed
 * evidence read shares — a `../`-laced pointer can never escape it, whether the
 * caller went on to read text, bytes, or the listing.
 */
function confinedEvidenceDir(repoPath: string, evidenceDir: string): string | null {
  const evidenceRoot = path.resolve(guardDir(repoPath), 'evidence');
  const dir = path.resolve(repoPath, evidenceDir);
  if (dir !== evidenceRoot && !dir.startsWith(evidenceRoot + path.sep)) return null;
  return dir;
}

/**
 * The absolute path of one evidence file, or `null` for an unsafe file name, a
 * directory outside the evidence root, or a path that is not an existing file.
 */
function confinedEvidenceFile(
  repoPath: string,
  evidenceDir: string,
  file: string,
): string | null {
  if (!SAFE_SEGMENT.test(file)) return null;
  const dir = confinedEvidenceDir(repoPath, evidenceDir);
  if (dir == null) return null;
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

/** The PR-overlay sentinel scope (`_pr/<number>`) — enterprise-only. */
function isPrScope(scope: string | undefined): boolean {
  return /^_pr\/\d+$/.test(scope ?? '');
}
const PR_DECISIONS_FILE_ERROR =
  '[guard-store] PR-scoped guard decisions require the enterprise store';

/** Recursively collect `*.yaml` / `*.yml` under `dir` (absolute paths, sorted). */
function collectYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectYamlFiles(full));
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// File-backed default impl (OSS) — synchronous guard-runner fs under an async
// surface; reads the live repo tree in place.
// ---------------------------------------------------------------------------

class FileGuardStore implements GuardStore {
  readonly materializesInPlace = true;

  async readGuardLatest(repoPath: string): Promise<GuardLatest | null> {
    return fileReadGuardLatest(repoPath);
  }

  async writeGuardLatest(repoPath: string, latest: GuardLatest): Promise<void> {
    fileWriteGuardLatest(repoPath, latest);
  }

  async writeGuardRun(repoPath: string, latest: GuardLatest): Promise<WrittenGuardRun> {
    fileWriteGuardRun(repoPath, latest);
    return { runId: latest.run.runId, latest };
  }

  async readGuardRun(repoPath: string, runId: string): Promise<GuardLatest | null> {
    if (!SAFE_SEGMENT.test(runId)) return null;
    const file = guardRunPath(repoPath, runId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = GuardLatestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // The file store keeps one materialized snapshot (LATEST) — the exact-commit
  // read is a match against its envelope, not a scan of runs/ or history.
  async readGuardRunForCommit(repoPath: string, commitSha: string): Promise<GuardLatest | null> {
    const latest = fileReadGuardLatest(repoPath);
    return latest && latest.run.commit === commitSha ? latest : null;
  }

  async readGuardHistory(repoPath: string): Promise<GuardHistory> {
    return fileReadGuardHistory(repoPath);
  }

  async appendGuardHistory(repoPath: string, entry: GuardHistoryEntry): Promise<void> {
    fileAppendGuardHistory(repoPath, entry);
  }

  // The file impl reads the live store — there is no per-commit history, so
  // `commitSha` is ignored (OSS is latest). Same for the corpus reads below.
  async readGuardResult(repoKey: string, _commitSha?: string): Promise<GuardGenerateReport | null> {
    return fileReadGuardResult(repoKey);
  }

  async writeGuardResult(ref: RepoRef, report: GuardGenerateReport): Promise<void> {
    fileWriteGuardResult(ref.repoKey, report);
  }

  async readGuardBaselineCommit(): Promise<string | null> {
    return null;
  }

  async writeGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    files: Record<string, string | Buffer>,
  ): Promise<string> {
    const dir = evidenceScenarioDir(repoPath, runId, scenarioId);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      if (!SAFE_SEGMENT.test(file)) {
        throw new Error(`[guard-store] unsafe evidence file name: ${file}`);
      }
      fs.writeFileSync(path.join(dir, file), content);
    }
    return evidenceRelPath(runId, scenarioId);
  }

  async readGuardEvidence(
    repoPath: string,
    runId: string,
    scenarioId: string,
    file: string,
  ): Promise<string | null> {
    if (!SAFE_SEGMENT.test(runId) || !SAFE_SEGMENT.test(file)) return null;
    const full = path.resolve(evidenceScenarioDir(repoPath, runId, scenarioId), file);
    const runDir = path.resolve(evidenceRunDir(repoPath, runId));
    if (full !== runDir && !full.startsWith(runDir + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  async readGuardEvidenceAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<string | null> {
    const full = confinedEvidenceFile(repoPath, evidenceDir, file);
    return full == null ? null : fs.readFileSync(full, 'utf-8');
  }

  async listGuardEvidenceAt(repoPath: string, evidenceDir: string): Promise<string[]> {
    const dir = confinedEvidenceDir(repoPath, evidenceDir);
    if (dir == null || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  }

  async readGuardEvidenceBytesAt(
    repoPath: string,
    evidenceDir: string,
    file: string,
  ): Promise<Buffer | null> {
    const full = confinedEvidenceFile(repoPath, evidenceDir, file);
    return full == null ? null : fs.readFileSync(full);
  }

  async writeGuardResultEvidence(): Promise<void> {
    // No-op: OSS birth evidence already lives in the working tree under
    // `.truecourse/guard/evidence/`, where `readGuardEvidenceAt` reads it directly.
    // Only the hosted store (ephemeral checkout) must copy it out.
  }

  async saveScenarios(ref: RepoRef, _sourceDir: string): Promise<SaveScenariosResult> {
    // The corpus is already on disk (the guard-runner/generator wrote it in place),
    // so there is nothing to copy — report the count, matching the contract store.
    // The commit is ignored: OSS has no per-commit history.
    return { fileCount: walkScenarioRelFiles(scenariosDir(ref.repoKey)).length };
  }

  async loadScenarios(ref: RepoRef): Promise<LoadedScenarios> {
    return fileLoadScenarios(ref.repoKey);
  }

  async readManifest(repoKey: string, _commitSha?: string): Promise<GuardManifest | null> {
    return fileReadManifest(repoKey);
  }

  async readRecipeRaw(repoKey: string, _commitSha?: string): Promise<string | null> {
    const file = recipePath(repoKey);
    if (!fs.existsSync(file)) return null;
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  }

  async listScenarioFiles(repoKey: string, _commitSha?: string): Promise<string[]> {
    return collectYamlFiles(scenariosDir(repoKey))
      .map((f) => path.relative(repoKey, f).split(path.sep).join('/'))
      .sort();
  }

  async readScenarioFile(repoKey: string, relPath: string, _commitSha?: string): Promise<string | null> {
    const root = path.resolve(scenariosDir(repoKey));
    const full = path.resolve(repoKey, relPath);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf-8');
  }

  async saveGuardSetupBundle(): Promise<void> {
    // No-op: setup wrote these files into the working tree, which is the store.
  }

  async loadGuardSetupBundle(): Promise<Record<string, string> | null> {
    // Nothing to materialize — the tree already holds whatever setup left.
    return null;
  }

  async readGuardDecisions(repoPath: string, scope?: string): Promise<GuardDecisions> {
    if (isPrScope(scope)) throw new Error(PR_DECISIONS_FILE_ERROR);
    return fileReadGuardDecisions(repoPath);
  }

  async writeGuardDecisions(
    repoPath: string,
    decisions: GuardDecisions,
    scope?: string,
  ): Promise<void> {
    if (isPrScope(scope)) throw new Error(PR_DECISIONS_FILE_ERROR);
    fileWriteGuardDecisions(repoPath, decisions);
  }

  async deleteGuardDecisions(repoPath: string, scope?: string): Promise<void> {
    if (isPrScope(scope)) throw new Error(PR_DECISIONS_FILE_ERROR);
    try {
      fs.unlinkSync(guardDecisionsPath(repoPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Active store registry + public delegators (same names, now async).
// ---------------------------------------------------------------------------

let active: GuardStore = new FileGuardStore();

/** The active guard store (file-backed unless EE installed a Postgres/Blob one). */
export function getGuardStore(): GuardStore {
  return active;
}
/** True when the active guard store keys by an on-disk path (OSS file store). */
export const guardsMaterializeInPlace = (): boolean => active.materializesInPlace;
/** Install a guard store (e.g. the enterprise Postgres/Blob impl). */
export function setGuardStore(store: GuardStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetGuardStore(): void {
  active = new FileGuardStore();
}

export const readGuardLatest = (repoPath: string): Promise<GuardLatest | null> =>
  active.readGuardLatest(repoPath);
export const writeGuardLatest = (repoPath: string, latest: GuardLatest): Promise<void> =>
  active.writeGuardLatest(repoPath, latest);
export const writeGuardRun = (repoPath: string, latest: GuardLatest): Promise<WrittenGuardRun> =>
  active.writeGuardRun(repoPath, latest);
export const readGuardRun = (repoPath: string, runId: string): Promise<GuardLatest | null> =>
  active.readGuardRun(repoPath, runId);
export const readGuardRunForCommit = (
  repoPath: string,
  commitSha: string,
): Promise<GuardLatest | null> => active.readGuardRunForCommit(repoPath, commitSha);
export const readGuardHistory = (
  repoPath: string,
  opts?: GuardHistoryReadOptions,
): Promise<GuardHistory> => active.readGuardHistory(repoPath, opts);
export const appendGuardHistory = (repoPath: string, entry: GuardHistoryEntry): Promise<void> =>
  active.appendGuardHistory(repoPath, entry);
export const readGuardResult = (
  repoKey: string,
  commitSha?: string,
): Promise<GuardGenerateReport | null> => active.readGuardResult(repoKey, commitSha);
export const writeGuardResult = (
  ref: RepoRef,
  report: GuardGenerateReport,
  opts?: { baseline?: boolean },
): Promise<void> => active.writeGuardResult(ref, report, opts);
export const readGuardBaselineCommit = (repoKey: string): Promise<string | null> =>
  active.readGuardBaselineCommit(repoKey);

export const writeGuardEvidence = (
  repoPath: string,
  runId: string,
  scenarioId: string,
  files: Record<string, string | Buffer>,
): Promise<string> => active.writeGuardEvidence(repoPath, runId, scenarioId, files);
export const readGuardEvidence = (
  repoPath: string,
  runId: string,
  scenarioId: string,
  file: string,
): Promise<string | null> => active.readGuardEvidence(repoPath, runId, scenarioId, file);
export const readGuardEvidenceAt = (
  repoPath: string,
  evidenceDir: string,
  file: string,
): Promise<string | null> => active.readGuardEvidenceAt(repoPath, evidenceDir, file);
export const listGuardEvidenceAt = (repoPath: string, evidenceDir: string): Promise<string[]> =>
  active.listGuardEvidenceAt(repoPath, evidenceDir);
export const readGuardEvidenceBytesAt = (
  repoPath: string,
  evidenceDir: string,
  file: string,
): Promise<Buffer | null> => active.readGuardEvidenceBytesAt(repoPath, evidenceDir, file);
export const writeGuardResultEvidence = (
  ref: RepoRef,
  scenarioSeg: string,
  files: Record<string, string | Buffer>,
): Promise<void> => active.writeGuardResultEvidence(ref, scenarioSeg, files);

export const saveScenarios = (ref: RepoRef, sourceDir: string): Promise<SaveScenariosResult> =>
  active.saveScenarios(ref, sourceDir);
export const loadScenarios = (ref: RepoRef): Promise<LoadedScenarios> =>
  active.loadScenarios(ref);
export const readManifest = (repoKey: string, commitSha?: string): Promise<GuardManifest | null> =>
  active.readManifest(repoKey, commitSha);
export const readRecipeRaw = (repoKey: string, commitSha?: string): Promise<string | null> =>
  active.readRecipeRaw(repoKey, commitSha);
export const listScenarioFiles = (repoKey: string, commitSha?: string): Promise<string[]> =>
  active.listScenarioFiles(repoKey, commitSha);
export const readScenarioFile = (
  repoKey: string,
  relPath: string,
  commitSha?: string,
): Promise<string | null> => active.readScenarioFile(repoKey, relPath, commitSha);

export const saveGuardSetupBundle = (
  ref: RepoRef,
  files: Record<string, string>,
): Promise<void> => active.saveGuardSetupBundle(ref, files);
export const loadGuardSetupBundle = (
  repoKey: string,
  commitSha?: string,
): Promise<Record<string, string> | null> => active.loadGuardSetupBundle(repoKey, commitSha);

export const readGuardDecisions = (repoPath: string, scope?: string): Promise<GuardDecisions> =>
  active.readGuardDecisions(repoPath, scope);
export const writeGuardDecisions = (
  repoPath: string,
  decisions: GuardDecisions,
  scope?: string,
): Promise<void> => active.writeGuardDecisions(repoPath, decisions, scope);
export const deleteGuardDecisions = (repoPath: string, scope?: string): Promise<void> =>
  active.deleteGuardDecisions(repoPath, scope);
