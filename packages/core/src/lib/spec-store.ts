/**
 * The spec store — the curated spec documents (`corpus.json`, `decisions.json`)
 * and the snapshot of every document body a scan kept.
 *
 * They are small JSON documents queried whole, so the seam is
 * document-oriented (named artifact → JSON) and the store keeps them inline as
 * `jsonb`. The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store`; boot installs the Postgres store over it.
 */

import type { RepoRef, WorkspaceRef } from './repo-ref.js';

export type { RepoRef, WorkspaceRef } from './repo-ref.js';

/**
 * Per-(repo, commit) JSON artifacts. `corpus`/`decisions` are the curated spec
 * (areas + relations + overlaps, and the user's curation intent).
 */
export type SpecArtifact =
  // The curated doc corpus (areas + relations + overlaps).
  | 'corpus'
  | 'decisions'
  // The DOCUMENT SNAPSHOT of a scan: `{ v, files: { <doc ref>: <content sha> } }`
  // over the kept documents' bodies, so a repository — which has no working
  // tree between runs — can show a document exactly as the scan read it.
  // Written through `saveSpecDocs`, read through `loadSpecDoc`.
  | 'docs';

/** Where a repository's and a workspace's curated specs are kept. */
export interface SpecStore {
  /** Persist one spec JSON artifact for `(ref)`. Overwrites prior content. */
  saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void>;
  /** Read one spec JSON artifact at a specific `ref`, or `null` when absent. */
  loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null>;
  /**
   * Delete one spec JSON artifact for `(ref)`. Idempotent — a no-op when absent.
   * Used to drop a PR-scoped `decisions` overlay row on merge/close.
   */
  deleteSpec(ref: RepoRef, artifact: SpecArtifact): Promise<void>;
  /** Read the repo's CURRENT artifact (the latest stored, for the dashboard), or `null`. */
  loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null>;
  /**
   * The repo's latest stored commit SHA (the one `loadLatest` reads from), or
   * `null` when nothing is stored.
   */
  latestCommit(repoKey: string): Promise<string | null>;
  /**
   * Persist one spec JSON artifact under WORKSPACE scope. Always-latest: one
   * current row per `(workspaceOrgId, artifact)`, no commit.
   */
  saveWorkspaceSpec(ref: WorkspaceRef, artifact: SpecArtifact, json: unknown): Promise<void>;
  /** Read one workspace spec artifact, or `null`. */
  loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact): Promise<T | null>;
  /**
   * Snapshot the workspace scan's kept documents — `{ contextRef: body }` — so
   * a document can still be read exactly as the scan read it after its source
   * dropped or rewrote it (the context ledger keeps only what a source yields
   * NOW, and sweeps the bodies it stops naming). Bodies are content-addressed
   * under the workspace's spec scope.
   */
  saveWorkspaceSpecDocs(ref: WorkspaceRef, files: Record<string, string>): Promise<void>;
  /** One snapshotted workspace document's body, or `null` when it is not in it. */
  loadWorkspaceSpecDoc(workspaceOrgId: string, docRef: string): Promise<string | null>;
  /**
   * Snapshot the kept documents' bodies for `ref` — `{ docRef: body }`. The
   * store content-addresses the bodies and writes the `docs` manifest.
   */
  saveSpecDocs(ref: RepoRef, files: Record<string, string>): Promise<void>;
  /**
   * One document's body as the scan read it: the snapshot at `commitSha` when
   * given, else the newest snapshot's. `null` when the document is not in it.
   */
  loadSpecDoc(repoKey: string, docRef: string, commitSha?: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// The installed store + its delegators.
// ---------------------------------------------------------------------------

let installed: SpecStore | null = null;

/** The active spec store. */
export function getSpecStore(): SpecStore {
  if (!installed) throw new Error('No spec store installed (boot did not run installDbStores).');
  return installed;
}
/** Install the spec store (boot: the Postgres one). */
export function setSpecStore(store: SpecStore): void {
  installed = store;
}
/** Forget the installed store (tests). */
export function resetSpecStore(): void {
  installed = null;
}

export const saveSpec = (ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void> =>
  getSpecStore().saveSpec(ref, artifact, json);
export const loadSpec = <T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null> =>
  getSpecStore().loadSpec<T>(ref, artifact);
export const deleteSpec = (ref: RepoRef, artifact: SpecArtifact): Promise<void> =>
  getSpecStore().deleteSpec(ref, artifact);
export const loadLatestSpec = <T = unknown>(
  repoKey: string,
  artifact: SpecArtifact,
): Promise<T | null> => getSpecStore().loadLatest<T>(repoKey, artifact);
export const latestSpecCommit = (repoKey: string): Promise<string | null> =>
  getSpecStore().latestCommit(repoKey);
export const saveSpecDocs = (ref: RepoRef, files: Record<string, string>): Promise<void> =>
  getSpecStore().saveSpecDocs(ref, files);
export const loadSpecDoc = (
  repoKey: string,
  docRef: string,
  commitSha?: string,
): Promise<string | null> => getSpecStore().loadSpecDoc(repoKey, docRef, commitSha);
export const saveWorkspaceSpec = (
  ref: WorkspaceRef,
  artifact: SpecArtifact,
  json: unknown,
): Promise<void> => getSpecStore().saveWorkspaceSpec(ref, artifact, json);
export const loadWorkspaceSpec = <T = unknown>(
  ref: WorkspaceRef,
  artifact: SpecArtifact,
): Promise<T | null> => getSpecStore().loadWorkspaceSpec<T>(ref, artifact);
export const saveWorkspaceSpecDocs = (
  ref: WorkspaceRef,
  files: Record<string, string>,
): Promise<void> => getSpecStore().saveWorkspaceSpecDocs(ref, files);
export const loadWorkspaceSpecDoc = (
  workspaceOrgId: string,
  docRef: string,
): Promise<string | null> => getSpecStore().loadWorkspaceSpecDoc(workspaceOrgId, docRef);
