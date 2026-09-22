/**
 * The guard store — where a repository's guard state lives: the run snapshots
 * and their history, the generate reports, the evidence bundles, the scenario
 * sets, setup's bundles and the user's dismissals.
 *
 * The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store` (the dependency runs the other way): boot installs
 * the Postgres store over it, keyed by repository identity and commit. A run's
 * working tree is where the engine reads and writes those documents as files
 * (`@truecourse/guard-runner`); this is where they are kept.
 *
 * Everything a run PRODUCES is a SERIES, never a row that is overwritten: a
 * scenario set, a generate report and a setup bundle each get a new version per
 * producing run, carrying which run wrote it and on which model, and the
 * current one is the newest of its series. A series is addressed by its SCOPE
 * (`DEFAULT_SCOPE`, the default branch, unless a ref or a read names another),
 * so a pull request's versions are the same mechanism under a scope of their
 * own. Runs are a series already, keyed by run id, and a rerun at a commit is a
 * new run beside the old one.
 */

import type { LoadedScenarios } from '@truecourse/guard-runner';
import type {
  GuardDecisions,
  GuardRunFlowSummary,
  GuardRunSectionSummary,
  GuardGenerateReport,
  GuardHistory,
  GuardHistoryEntry,
  GuardLatest,
  GuardManifest,
  GuardVersion,
  GuardVersionArtifact,
} from '@truecourse/shared';
import type { RepoRef, VersionAt, VersionProvenance } from './repo-ref.js';

// `RepoRef` and the version handles are declared in repo-ref.ts (the canonical
// home for store scope handles) and re-exported here so guard callers share one
// definition — the same convention spec-store.ts follows.
export type { RepoRef, VersionAt, VersionProvenance } from './repo-ref.js';
export { DEFAULT_SCOPE, versionAt } from './repo-ref.js';

/** How wide a history read is: one scope's trend (the default branch's unless
 *  named) or every stored run of every scope. */
export interface GuardHistoryReadOptions {
  all?: boolean;
  scope?: string;
}

/** Where a run snapshot is written: the scope it belongs to, and who produced it. */
export interface GuardRunWriteOptions {
  scope?: string;
  provenance?: VersionProvenance;
}

/** Which versions to list: one scope's (the default branch's unless named), newest first. */
export interface GuardVersionListOptions {
  scope?: string;
  limit?: number;
}

/** A written run snapshot — the runId it is keyed by plus the stored state. */
export interface WrittenGuardRun {
  runId: string;
  latest: GuardLatest;
}

/** Result of snapshotting the on-disk scenario set: the version it became. */
export interface SaveScenariosResult {
  fileCount: number;
  versionId: string;
}

/**
 * ONE baseline run's coverage history: when it ran, and what every section and
 * every flow it covered was worth then. The trend on Home is these rows and
 * nothing else. A run without one is absent from history.
 */
export interface GuardRunCoverage {
  runId: string;
  ranAt: string;
  commit: string | null;
  sections: GuardRunSectionSummary;
  /**
   * The run's flows, which is what Home's trend counts. Three states: a
   * summary, which the trend draws; an EMPTY summary, meaning the derivation
   * ran and found nothing to record (no flow corpus, no snapshot), so the run
   * stays out of the flow trend and is never asked again; and null, meaning it
   * was never derived or the last attempt failed, which the next Home read
   * repairs.
   */
  flows: GuardRunFlowSummary | null;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Pluggable guard store. Nothing is installed by default; boot installs the
 *  Postgres one. */
export interface GuardStore {
  // --- Run state ------------------------------------------------------------
  /** The newest run of a scope (the default branch's unless named). */
  readGuardLatest(repoPath: string, scope?: string): Promise<GuardLatest | null>;
  /**
   * Persist a run as the scope's newest. A run id already stored is updated in
   * place (the adjudication fold re-writes a run with its verdicts); any other
   * run is a new row beside the ones before it.
   */
  writeGuardLatest(repoPath: string, latest: GuardLatest, opts?: GuardRunWriteOptions): Promise<void>;
  /** Persist a per-run snapshot the same way; returns its runId key + the stored state. */
  writeGuardRun(
    repoPath: string,
    latest: GuardLatest,
    opts?: GuardRunWriteOptions,
  ): Promise<WrittenGuardRun>;
  /** Read + validate a past run snapshot by runId, or `null` (unsafe id / absent). */
  readGuardRun(repoPath: string, runId: string): Promise<GuardLatest | null>;
  /** The newest stored run at an exact commit in a scope — what a commit-pinned
   *  view and the staleness probe read. `null` when none. */
  readGuardRunForCommit(
    repoPath: string,
    commitSha: string,
    scope?: string,
  ): Promise<GuardLatest | null>;
  /**
   * The run trend: one scope's runs, oldest-first. `all` widens it to EVERY
   * stored run, whatever its scope or origin — what the Runs tab reads.
   */
  readGuardHistory(repoPath: string, opts?: GuardHistoryReadOptions): Promise<GuardHistory>;
  appendGuardHistory(repoPath: string, entry: GuardHistoryEntry): Promise<void>;
  /**
   * Record a stored run's SECTION and FLOW summaries, written beside the run
   * when it is persisted. Re-writing one replaces it.
   */
  writeGuardRunCoverage(repoPath: string, run: GuardRunCoverage): Promise<void>;
  /**
   * Every run of a scope that carries a section summary, oldest first. A run
   * whose summary could not be derived is simply not here.
   */
  readGuardRunCoverage(repoPath: string, scope?: string): Promise<GuardRunCoverage[]>;
  /** The `guard generate` report `at` names: the newest of the scope, the
   *  newest at a commit, or one version by id. */
  readGuardResult(repoKey: string, at?: VersionAt): Promise<GuardGenerateReport | null>;
  /** Persist a generate report as a new version of `ref`'s series. */
  writeGuardResult(
    ref: RepoRef,
    report: GuardGenerateReport,
    provenance?: VersionProvenance,
  ): Promise<void>;
  /**
   * The commit the scope's CURRENT state was produced at: the newest of its
   * scenario sets and its reports, whichever was stored last — a generate
   * stores both at one commit, a blocked generate a report alone. `null` when
   * it holds neither. The repo-level guard views anchor on it: it names the
   * set and the report they read.
   */
  readGuardBaselineCommit(repoKey: string, scope?: string): Promise<string | null>;

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
   * the newest generate report at `ref`'s commit instead, resolved by
   * `readGuardEvidenceAt`'s fallback. `scenarioSeg` is the finding's
   * already-sanitized evidencePath basename (re-sanitized defensively); file
   * names must be plain (no separators / `..`).
   */
  writeGuardResultEvidence(
    ref: RepoRef,
    scenarioSeg: string,
    files: Record<string, string | Buffer>,
  ): Promise<void>;

  // --- Scenario sets --------------------------------------------------------
  // Saves are per `RepoRef` (repo + commit + scope; an empty commit is
  // rejected) and make a new version; reads take a `VersionAt` and answer the
  // scope's newest version when it names nothing more.
  /** Snapshot the scenario tree at `sourceDir` as a new version of `ref`'s series. */
  saveScenarios(
    ref: RepoRef,
    sourceDir: string,
    provenance?: VersionProvenance,
  ): Promise<SaveScenariosResult>;
  /** The newest set at that commit, parsed — the exact commit, no fallback. */
  loadScenarios(ref: RepoRef): Promise<LoadedScenarios>;
  readManifest(repoKey: string, at?: VersionAt): Promise<GuardManifest | null>;
  /** Raw `recipe.json` content, or `null` when absent. */
  readRecipeRaw(repoKey: string, at?: VersionAt): Promise<string | null>;
  /** Repo-relative posix paths of every stored scenario YAML (sorted). */
  listScenarioFiles(repoKey: string, at?: VersionAt): Promise<string[]>;
  /** One scenario YAML's content by its repo-relative path, or `null`. */
  readScenarioFile(repoKey: string, relPath: string, at?: VersionAt): Promise<string | null>;

  // --- Setup bundle ---------------------------------------------------------
  // What `guard setup` leaves behind (the settle spine, findings, recipe,
  // dependency catalog, seed script) as `{ treeRelativePath: content }`. A
  // series like the scenario sets: saves make a version, reads take a `VersionAt`.
  /** Snapshot setup's files as a new version of `ref`'s series. */
  saveGuardSetupBundle(
    ref: RepoRef,
    files: Record<string, string>,
    provenance?: VersionProvenance,
  ): Promise<void>;
  /** The bundle `at` names, else the scope's newest; `null` when there is none. */
  loadGuardSetupBundle(repoKey: string, at?: VersionAt): Promise<Record<string, string> | null>;

  // --- Versions -------------------------------------------------------------
  /** One series' versions, newest first, each with its provenance. */
  listGuardVersions(
    repoKey: string,
    artifact: GuardVersionArtifact,
    opts?: GuardVersionListOptions,
  ): Promise<GuardVersion[]>;
  /** One version's record by id, whatever its scope; `null` when the id names none. */
  readGuardVersion(
    repoKey: string,
    artifact: GuardVersionArtifact,
    versionId: string,
  ): Promise<GuardVersion | null>;
  /**
   * Roll a scenario set back: an older version becomes the newest of its
   * series again, as a NEW version holding the same files, so the series stays
   * append-only and the rollback is itself on record. `null` when the id names
   * no scenario set of this repository.
   */
  restoreGuardScenarioSet(
    repoKey: string,
    versionId: string,
    provenance?: VersionProvenance,
  ): Promise<GuardVersion | null>;

  // --- Decisions ------------------------------------------------------------
  // The repository's dismissal ledger, one row per repo.
  readGuardDecisions(repoPath: string): Promise<GuardDecisions>;
  writeGuardDecisions(repoPath: string, decisions: GuardDecisions): Promise<void>;
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

export const readGuardLatest = (repoPath: string, scope?: string): Promise<GuardLatest | null> =>
  getGuardStore().readGuardLatest(repoPath, scope);
export const writeGuardLatest = (
  repoPath: string,
  latest: GuardLatest,
  opts?: GuardRunWriteOptions,
): Promise<void> => getGuardStore().writeGuardLatest(repoPath, latest, opts);
export const writeGuardRun = (
  repoPath: string,
  latest: GuardLatest,
  opts?: GuardRunWriteOptions,
): Promise<WrittenGuardRun> => getGuardStore().writeGuardRun(repoPath, latest, opts);
export const readGuardRun = (repoPath: string, runId: string): Promise<GuardLatest | null> =>
  getGuardStore().readGuardRun(repoPath, runId);
export const readGuardRunForCommit = (
  repoPath: string,
  commitSha: string,
  scope?: string,
): Promise<GuardLatest | null> => getGuardStore().readGuardRunForCommit(repoPath, commitSha, scope);
export const readGuardHistory = (
  repoPath: string,
  opts?: GuardHistoryReadOptions,
): Promise<GuardHistory> => getGuardStore().readGuardHistory(repoPath, opts);
export const appendGuardHistory = (repoPath: string, entry: GuardHistoryEntry): Promise<void> =>
  getGuardStore().appendGuardHistory(repoPath, entry);
export const writeGuardRunCoverage = (repoPath: string, run: GuardRunCoverage): Promise<void> =>
  getGuardStore().writeGuardRunCoverage(repoPath, run);
export const readGuardRunCoverage = (repoPath: string, scope?: string): Promise<GuardRunCoverage[]> =>
  getGuardStore().readGuardRunCoverage(repoPath, scope);
export const readGuardResult = (
  repoKey: string,
  at?: VersionAt,
): Promise<GuardGenerateReport | null> => getGuardStore().readGuardResult(repoKey, at);
export const writeGuardResult = (
  ref: RepoRef,
  report: GuardGenerateReport,
  provenance?: VersionProvenance,
): Promise<void> => getGuardStore().writeGuardResult(ref, report, provenance);
export const readGuardBaselineCommit = (repoKey: string, scope?: string): Promise<string | null> =>
  getGuardStore().readGuardBaselineCommit(repoKey, scope);

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

export const saveScenarios = (
  ref: RepoRef,
  sourceDir: string,
  provenance?: VersionProvenance,
): Promise<SaveScenariosResult> => getGuardStore().saveScenarios(ref, sourceDir, provenance);
export const loadScenarios = (ref: RepoRef): Promise<LoadedScenarios> =>
  getGuardStore().loadScenarios(ref);
export const readManifest = (repoKey: string, at?: VersionAt): Promise<GuardManifest | null> =>
  getGuardStore().readManifest(repoKey, at);
export const readRecipeRaw = (repoKey: string, at?: VersionAt): Promise<string | null> =>
  getGuardStore().readRecipeRaw(repoKey, at);
export const listScenarioFiles = (repoKey: string, at?: VersionAt): Promise<string[]> =>
  getGuardStore().listScenarioFiles(repoKey, at);
export const readScenarioFile = (
  repoKey: string,
  relPath: string,
  at?: VersionAt,
): Promise<string | null> => getGuardStore().readScenarioFile(repoKey, relPath, at);

export const saveGuardSetupBundle = (
  ref: RepoRef,
  files: Record<string, string>,
  provenance?: VersionProvenance,
): Promise<void> => getGuardStore().saveGuardSetupBundle(ref, files, provenance);
export const loadGuardSetupBundle = (
  repoKey: string,
  at?: VersionAt,
): Promise<Record<string, string> | null> => getGuardStore().loadGuardSetupBundle(repoKey, at);

export const listGuardVersions = (
  repoKey: string,
  artifact: GuardVersionArtifact,
  opts?: GuardVersionListOptions,
): Promise<GuardVersion[]> => getGuardStore().listGuardVersions(repoKey, artifact, opts);
export const readGuardVersion = (
  repoKey: string,
  artifact: GuardVersionArtifact,
  versionId: string,
): Promise<GuardVersion | null> => getGuardStore().readGuardVersion(repoKey, artifact, versionId);
export const restoreGuardScenarioSet = (
  repoKey: string,
  versionId: string,
  provenance?: VersionProvenance,
): Promise<GuardVersion | null> =>
  getGuardStore().restoreGuardScenarioSet(repoKey, versionId, provenance);

export const readGuardDecisions = (repoPath: string): Promise<GuardDecisions> =>
  getGuardStore().readGuardDecisions(repoPath);
export const writeGuardDecisions = (
  repoPath: string,
  decisions: GuardDecisions,
): Promise<void> => getGuardStore().writeGuardDecisions(repoPath, decisions);
