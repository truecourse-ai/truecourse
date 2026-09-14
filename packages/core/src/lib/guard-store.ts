/**
 * The guard store — where a repository's guard state lives: the run snapshots
 * and their history, the generate report, the evidence bundles, the scenario
 * corpus, setup's bundle and the user's dismissals.
 *
 * The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store` (the dependency runs the other way): boot installs
 * the Postgres store over it, keyed by repository identity and commit. A run's
 * working tree is where the engine reads and writes those documents as files
 * (`@truecourse/guard-runner`); this is where they are kept.
 */

import type { LoadedScenarios } from '@truecourse/guard-runner';
import type {
  GuardDecisions,
  GuardRunSectionSummary,
  GuardGenerateReport,
  GuardHistory,
  GuardHistoryEntry,
  GuardLatest,
  GuardManifest,
} from '@truecourse/shared';
import type { RepoRef } from './repo-ref.js';

// `RepoRef` is declared in repo-ref.ts (the canonical home for store scope
// handles) and re-exported here so guard callers share one definition — the same
// convention spec-store.ts follows.
export type { RepoRef } from './repo-ref.js';

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

/**
 * ONE baseline run's section history: when it ran and what every section of the
 * documents its scenario set covered was worth then. The trend on Home is these
 * rows and nothing else. A run without one is absent from history.
 */
export interface GuardRunSections {
  runId: string;
  ranAt: string;
  commit: string | null;
  sections: GuardRunSectionSummary;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Pluggable guard store. File-backed by default; EE injects Postgres/Blob. */
export interface GuardStore {
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
   */
  readGuardHistory(repoPath: string, opts?: GuardHistoryReadOptions): Promise<GuardHistory>;
  appendGuardHistory(repoPath: string, entry: GuardHistoryEntry): Promise<void>;
  /**
   * Record a stored run's SECTION SUMMARY, written beside the run when it is
   * persisted. Re-writing one replaces it.
   */
  writeGuardRunSections(repoPath: string, run: GuardRunSections): Promise<void>;
  /**
   * Every BASELINE run that carries a section summary, oldest first. A run
   * whose summary could not be derived is simply not here.
   */
  readGuardRunSections(repoPath: string): Promise<GuardRunSections[]>;
  /**
   * The `guard generate` report at `commitSha`, or the newest stored one.
   */
  readGuardResult(repoKey: string, commitSha?: string): Promise<GuardGenerateReport | null>;
  /**
   * Persist a generate report for `ref`, keyed by its commit. `baseline` marks
   * a DEFAULT-BRANCH generate — the one the repo-level views anchor on (see
   * {@link GuardStore.readGuardBaselineCommit}); a PR head's regenerate never
   * sets it.
   */
  writeGuardResult(
    ref: RepoRef,
    report: GuardGenerateReport,
    opts?: { baseline?: boolean },
  ): Promise<void>;
  /**
   * The commit of the newest generate report written as a baseline, or `null`
   * when none was. The repo-level guard views anchor on it.
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
   * `persist: false`, so it never creates a run row — its transcripts attach to
   * the generate report (`ref`'s commit) instead, resolved by
   * `readGuardEvidenceAt`'s fallback. `scenarioSeg` is the finding's
   * already-sanitized evidencePath basename (re-sanitized defensively); file
   * names must be plain (no separators / `..`).
   */
  writeGuardResultEvidence(
    ref: RepoRef,
    scenarioSeg: string,
    files: Record<string, string | Buffer>,
  ): Promise<void>;

  // --- Scenario corpus ------------------------------------------------------
  // Saves are per `RepoRef` (repo + commit; an empty commit is rejected);
  // commit-optional reads fall back to the newest stored set.
  /** Snapshot the scenario tree at `sourceDir` for `ref`. */
  saveScenarios(ref: RepoRef, sourceDir: string): Promise<SaveScenariosResult>;
  /** That commit's scenarios, parsed — the exact set, no fallback. */
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
  // dependency catalog, seed script) as `{ treeRelativePath: content }`. Keyed
  // like the scenario corpus: saves per `RepoRef` (an empty commit is
  // rejected), commit-optional reads fall back to the newest stored bundle.
  /** Snapshot setup's files for `ref`. */
  saveGuardSetupBundle(ref: RepoRef, files: Record<string, string>): Promise<void>;
  /** That commit's bundle, else the newest stored one; `null` when there is none. */
  loadGuardSetupBundle(
    repoKey: string,
    commitSha?: string,
  ): Promise<Record<string, string> | null>;

  // --- Decisions ------------------------------------------------------------
  // `scope` (optional) selects a PR-scoped overlay (the `_pr/<n>` sentinel);
  // omitted → the repo-scoped decisions.
  readGuardDecisions(repoPath: string, scope?: string): Promise<GuardDecisions>;
  writeGuardDecisions(repoPath: string, decisions: GuardDecisions, scope?: string): Promise<void>;
  deleteGuardDecisions(repoPath: string, scope?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// The installed store + its delegators.
// ---------------------------------------------------------------------------

let installed: GuardStore | null = null;

/** The active guard store. */
export function getGuardStore(): GuardStore {
  if (!installed) throw new Error('No guard store installed (boot did not run installDbStores).');
  return installed;
}
/** Install the guard store (boot: the Postgres one). */
export function setGuardStore(store: GuardStore): void {
  installed = store;
}
/** Forget the installed store (tests). */
export function resetGuardStore(): void {
  installed = null;
}

export const readGuardLatest = (repoPath: string): Promise<GuardLatest | null> =>
  getGuardStore().readGuardLatest(repoPath);
export const writeGuardLatest = (repoPath: string, latest: GuardLatest): Promise<void> =>
  getGuardStore().writeGuardLatest(repoPath, latest);
export const writeGuardRun = (repoPath: string, latest: GuardLatest): Promise<WrittenGuardRun> =>
  getGuardStore().writeGuardRun(repoPath, latest);
export const readGuardRun = (repoPath: string, runId: string): Promise<GuardLatest | null> =>
  getGuardStore().readGuardRun(repoPath, runId);
export const readGuardRunForCommit = (
  repoPath: string,
  commitSha: string,
): Promise<GuardLatest | null> => getGuardStore().readGuardRunForCommit(repoPath, commitSha);
export const readGuardHistory = (
  repoPath: string,
  opts?: GuardHistoryReadOptions,
): Promise<GuardHistory> => getGuardStore().readGuardHistory(repoPath, opts);
export const appendGuardHistory = (repoPath: string, entry: GuardHistoryEntry): Promise<void> =>
  getGuardStore().appendGuardHistory(repoPath, entry);
export const writeGuardRunSections = (repoPath: string, run: GuardRunSections): Promise<void> =>
  getGuardStore().writeGuardRunSections(repoPath, run);
export const readGuardRunSections = (repoPath: string): Promise<GuardRunSections[]> =>
  getGuardStore().readGuardRunSections(repoPath);
export const readGuardResult = (
  repoKey: string,
  commitSha?: string,
): Promise<GuardGenerateReport | null> => getGuardStore().readGuardResult(repoKey, commitSha);
export const writeGuardResult = (
  ref: RepoRef,
  report: GuardGenerateReport,
  opts?: { baseline?: boolean },
): Promise<void> => getGuardStore().writeGuardResult(ref, report, opts);
export const readGuardBaselineCommit = (repoKey: string): Promise<string | null> =>
  getGuardStore().readGuardBaselineCommit(repoKey);

export const writeGuardEvidence = (
  repoPath: string,
  runId: string,
  scenarioId: string,
  files: Record<string, string | Buffer>,
): Promise<string> => getGuardStore().writeGuardEvidence(repoPath, runId, scenarioId, files);
export const readGuardEvidence = (
  repoPath: string,
  runId: string,
  scenarioId: string,
  file: string,
): Promise<string | null> => getGuardStore().readGuardEvidence(repoPath, runId, scenarioId, file);
export const readGuardEvidenceAt = (
  repoPath: string,
  evidenceDir: string,
  file: string,
): Promise<string | null> => getGuardStore().readGuardEvidenceAt(repoPath, evidenceDir, file);
export const listGuardEvidenceAt = (repoPath: string, evidenceDir: string): Promise<string[]> =>
  getGuardStore().listGuardEvidenceAt(repoPath, evidenceDir);
export const readGuardEvidenceBytesAt = (
  repoPath: string,
  evidenceDir: string,
  file: string,
): Promise<Buffer | null> => getGuardStore().readGuardEvidenceBytesAt(repoPath, evidenceDir, file);
export const writeGuardResultEvidence = (
  ref: RepoRef,
  scenarioSeg: string,
  files: Record<string, string | Buffer>,
): Promise<void> => getGuardStore().writeGuardResultEvidence(ref, scenarioSeg, files);

export const saveScenarios = (ref: RepoRef, sourceDir: string): Promise<SaveScenariosResult> =>
  getGuardStore().saveScenarios(ref, sourceDir);
export const loadScenarios = (ref: RepoRef): Promise<LoadedScenarios> =>
  getGuardStore().loadScenarios(ref);
export const readManifest = (repoKey: string, commitSha?: string): Promise<GuardManifest | null> =>
  getGuardStore().readManifest(repoKey, commitSha);
export const readRecipeRaw = (repoKey: string, commitSha?: string): Promise<string | null> =>
  getGuardStore().readRecipeRaw(repoKey, commitSha);
export const listScenarioFiles = (repoKey: string, commitSha?: string): Promise<string[]> =>
  getGuardStore().listScenarioFiles(repoKey, commitSha);
export const readScenarioFile = (
  repoKey: string,
  relPath: string,
  commitSha?: string,
): Promise<string | null> => getGuardStore().readScenarioFile(repoKey, relPath, commitSha);

export const saveGuardSetupBundle = (
  ref: RepoRef,
  files: Record<string, string>,
): Promise<void> => getGuardStore().saveGuardSetupBundle(ref, files);
export const loadGuardSetupBundle = (
  repoKey: string,
  commitSha?: string,
): Promise<Record<string, string> | null> => getGuardStore().loadGuardSetupBundle(repoKey, commitSha);

export const readGuardDecisions = (repoPath: string, scope?: string): Promise<GuardDecisions> =>
  getGuardStore().readGuardDecisions(repoPath, scope);
export const writeGuardDecisions = (
  repoPath: string,
  decisions: GuardDecisions,
  scope?: string,
): Promise<void> => getGuardStore().writeGuardDecisions(repoPath, decisions, scope);
export const deleteGuardDecisions = (repoPath: string, scope?: string): Promise<void> =>
  getGuardStore().deleteGuardDecisions(repoPath, scope);
