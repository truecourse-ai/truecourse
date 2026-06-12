/**
 * Spec store — the two consolidated spec JSON documents (`claims.json`,
 * `decisions.json`). File-backed by default (raw JSON under
 * `<repo>/.truecourse/specs/`, where the IL `spec-consolidator` writes them);
 * the enterprise edition injects a Postgres-backed impl via `setSpecStore`.
 *
 * Unlike contracts (a `.tc` tree), specs are two small JSON files queried whole,
 * so the seam is document-oriented (named artifact → JSON) and the EE impl keeps
 * them inline as `jsonb` (no blob).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RepoRef, WorkspaceRef } from './contract-store.js';

export type { RepoRef, WorkspaceRef } from './contract-store.js';

/**
 * Per-(repo, commit) JSON artifacts. `claims`/`decisions`/`scanState` are the
 * consolidated spec; `verifyState` is the verifier's drift snapshot for that
 * commit — persisted by the gate so the dashboard's ref switcher can show a PR's
 * drift (the verify-store's LATEST is per-repo, not per-commit). Written only in
 * EE (the gate passes a `ref`); OSS never stores it.
 *
 * `rawClaims`/`chains` are the pre-merge extracted claim set + detected version
 * chains. They are persisted under WORKSPACE scope only, so a decision can be
 * re-applied via a body-free `remerge()` without re-reading the source docs
 * (workspace Knowledge never stores the bodies). Repos re-derive these from the
 * working tree on each scan, so they don't persist them.
 */
export type SpecArtifact =
  | 'claims'
  | 'decisions'
  | 'scanState'
  | 'verifyState'
  | 'rawClaims'
  | 'chains';

/** Pluggable spec store. File-backed by default; EE injects Postgres. */
export interface SpecStore {
  /** Persist one spec JSON artifact for `(ref)`. Overwrites prior content. */
  saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void>;
  /** Read one spec JSON artifact at a specific `ref`, or `null` when absent. */
  loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null>;
  /** Read the repo's CURRENT artifact (the latest stored, for the dashboard), or `null`. */
  loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null>;
  /**
   * The repo's latest stored commit SHA (the one `loadLatest` reads from), or
   * `null` when nothing is stored. EE-only — the file impl materializes in place
   * and has no commit dimension, so it returns null.
   */
  latestCommit(repoKey: string): Promise<string | null>;
  /**
   * Persist one spec JSON artifact under WORKSPACE scope (enterprise only).
   * Always-latest: one current row per `(workspaceOrgId, artifact)`, no commit.
   * The file default throws — OSS/local has no workspace concept.
   */
  saveWorkspaceSpec(ref: WorkspaceRef, artifact: SpecArtifact, json: unknown): Promise<void>;
  /**
   * Read one workspace spec artifact, or `null`. The file default returns
   * `null` (so a future effective-spec read degrades to repo-only in OSS).
   */
  loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact): Promise<T | null>;
  /** `true` when load returns the live repo file (file impl). */
  readonly materializesInPlace: boolean;
}

/**
 * On-disk location per artifact. claims/decisions live under `specs/`;
 * scan-state lives under the consolidator's cache (`.cache/consolidator/`),
 * exactly where the IL writes them — so the file impl is byte-identical.
 */
function specPath(repoKey: string, artifact: SpecArtifact): string {
  if (artifact === 'scanState') {
    return path.join(repoKey, '.truecourse', '.cache', 'consolidator', 'scan-state.json');
  }
  return path.join(repoKey, '.truecourse', 'specs', `${artifact}.json`);
}

// ---------------------------------------------------------------------------
// File-backed default (OSS) — raw JSON at the same paths the IL writers use,
// so save/load round-trip the exact on-disk document.
// ---------------------------------------------------------------------------

class FileSpecStore implements SpecStore {
  readonly materializesInPlace = true;

  async saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void> {
    const file = specPath(ref.repoKey, artifact);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf-8');
  }

  async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null> {
    const file = specPath(ref.repoKey, artifact);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  // The file impl is single-document-per-repo, so "latest" === read the file.
  async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null> {
    return this.loadSpec<T>({ repoKey, commitSha: '' }, artifact);
  }

  // No commit dimension in the file edition.
  async latestCommit(): Promise<string | null> {
    return null;
  }

  // OSS/local has no workspace concept. Writing throws (fail loud — a caller
  // that reached here is mis-wired); reading is empty so an effective-spec read
  // degrades cleanly to repo-only without special-casing the file edition.
  async saveWorkspaceSpec(): Promise<void> {
    throw new Error('[spec-store] workspace-scoped specs require the enterprise store');
  }

  async loadWorkspaceSpec<T = unknown>(): Promise<T | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Active store registry + delegators.
// ---------------------------------------------------------------------------

let active: SpecStore = new FileSpecStore();

/** The active spec store (file-backed unless EE installed a Postgres one). */
export function getSpecStore(): SpecStore {
  return active;
}
/** Install a spec store (e.g. the enterprise Postgres impl). */
export function setSpecStore(store: SpecStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetSpecStore(): void {
  active = new FileSpecStore();
}

export const saveSpec = (ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void> =>
  active.saveSpec(ref, artifact, json);
export const loadSpec = <T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null> =>
  active.loadSpec<T>(ref, artifact);
export const loadLatestSpec = <T = unknown>(
  repoKey: string,
  artifact: SpecArtifact,
): Promise<T | null> => active.loadLatest<T>(repoKey, artifact);
export const latestSpecCommit = (repoKey: string): Promise<string | null> =>
  active.latestCommit(repoKey);
export const saveWorkspaceSpec = (
  ref: WorkspaceRef,
  artifact: SpecArtifact,
  json: unknown,
): Promise<void> => active.saveWorkspaceSpec(ref, artifact, json);
export const loadWorkspaceSpec = <T = unknown>(
  ref: WorkspaceRef,
  artifact: SpecArtifact,
): Promise<T | null> => active.loadWorkspaceSpec<T>(ref, artifact);
/** Whether the active spec store reads/writes the live repo files (file) or Postgres (EE). */
export const specsMaterializeInPlace = (): boolean => active.materializesInPlace;
