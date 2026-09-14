/**
 * The spec store — the curated spec documents (the corpus and the decisions
 * ledger) and the snapshot of every document body a scan kept.
 *
 * All of it is the WORKSPACE's: one current set per organization, no commit
 * dimension. A repository reads a SLICE of the corpus, derived at read time,
 * and resolves its conflicts in the workspace's one ledger.
 *
 * They are small JSON documents queried whole, so the seam is
 * document-oriented (named artifact → JSON) and the store keeps them inline as
 * `jsonb`. The seam exists because `@truecourse/core` cannot depend on
 * `@truecourse/data-store`; boot installs the Postgres store over it.
 */

import type { WorkspaceRef } from './repo-ref.js';

export type { WorkspaceRef } from './repo-ref.js';

/**
 * A workspace's JSON artifacts. `corpus`/`decisions` are the curated spec
 * (areas + relations + overlaps, and the user's curation intent).
 */
export type SpecArtifact =
  // The curated doc corpus (areas + relations + overlaps).
  | 'corpus'
  | 'decisions'
  // The DOCUMENT SNAPSHOT of a scan: `{ v, files: { <doc ref>: <content sha> } }`
  // over the kept documents' bodies, so a document can still be read exactly as
  // the scan read it after its source dropped or rewrote it.
  // Written through `saveWorkspaceSpecDocs`, read through `loadWorkspaceSpecDoc`.
  | 'docs';

/** Where a workspace's curated specs are kept. */
export interface SpecStore {
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
