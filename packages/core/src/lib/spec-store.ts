/**
 * The spec store — the curated spec documents (the corpus and the decisions
 * ledger) and the snapshot of every document body a scan kept.
 *
 * All of it is the WORKSPACE's: keyed by the organization, no repository. A
 * repository reads a SLICE of the corpus, derived at read time, and resolves
 * its conflicts in the workspace's one ledger.
 *
 * The corpus and the document snapshot are SERIES: every scan writes a new
 * version, carrying which run wrote it and on which model, and the current one
 * is the newest of its scope (the default line unless the ref names another —
 * a pull request's candidate corpus is the same series under its own scope).
 * The decisions are a ledger people edit one resolution at a time, so they
 * stay one current document per workspace.
 *
 * They are small JSON documents queried whole, so the seam is
 * document-oriented (named artifact → JSON). The seam exists because
 * `@truecourse/core` cannot depend on `@truecourse/data-store`; boot installs
 * the Postgres store over it.
 */

import type { WorkspaceSpecVersion, WorkspaceSpecVersionArtifact } from '@truecourse/shared';
import type { VersionProvenance, WorkspaceRef } from './repo-ref.js';

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

/** Who produced a workspace version, and for a candidate, the commit its documents came from. */
export interface WorkspaceSpecProvenance extends VersionProvenance {
  sourceCommit?: string | null;
}

/** Which version a workspace read lands on: the scope's newest unless an id names one. */
export interface WorkspaceSpecAt {
  id?: string;
}

/** Where a workspace's curated specs are kept. */
export interface SpecStore {
  /**
   * Persist one spec JSON artifact under WORKSPACE scope. The corpus and the
   * docs snapshot become a new version of the ref's series; the decisions
   * replace the workspace's one ledger.
   */
  saveWorkspaceSpec(
    ref: WorkspaceRef,
    artifact: SpecArtifact,
    json: unknown,
    provenance?: WorkspaceSpecProvenance,
  ): Promise<void>;
  /** Read one workspace spec artifact — the scope's newest, or the version `at` names — or `null`. */
  loadWorkspaceSpec<T = unknown>(
    ref: WorkspaceRef,
    artifact: SpecArtifact,
    at?: WorkspaceSpecAt,
  ): Promise<T | null>;
  /**
   * Snapshot the workspace scan's kept documents — `{ contextRef: body }` — so
   * a document can still be read exactly as the scan read it after its source
   * dropped or rewrote it (the context ledger keeps only what a source yields
   * NOW, and sweeps the bodies it stops naming). Bodies are content-addressed
   * under the workspace's spec scope.
   */
  saveWorkspaceSpecDocs(
    ref: WorkspaceRef,
    files: Record<string, string>,
    provenance?: WorkspaceSpecProvenance,
  ): Promise<void>;
  /** One snapshotted workspace document's body, or `null` when it is not in it. */
  loadWorkspaceSpecDoc(
    workspaceOrgId: string,
    docRef: string,
    ref?: Pick<WorkspaceRef, 'scope'> & WorkspaceSpecAt,
  ): Promise<string | null>;
  /** One series' versions, newest first, each with its provenance. */
  listWorkspaceSpecVersions(
    ref: WorkspaceRef,
    artifact: WorkspaceSpecVersionArtifact,
    opts?: { limit?: number },
  ): Promise<WorkspaceSpecVersion[]>;
  /** One version's record by id, whatever its scope; `null` when the id names none. */
  readWorkspaceSpecVersion(
    workspaceOrgId: string,
    artifact: WorkspaceSpecVersionArtifact,
    versionId: string,
  ): Promise<WorkspaceSpecVersion | null>;
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
  provenance?: WorkspaceSpecProvenance,
): Promise<void> => getSpecStore().saveWorkspaceSpec(ref, artifact, json, provenance);
export const loadWorkspaceSpec = <T = unknown>(
  ref: WorkspaceRef,
  artifact: SpecArtifact,
  at?: WorkspaceSpecAt,
): Promise<T | null> => getSpecStore().loadWorkspaceSpec<T>(ref, artifact, at);
export const saveWorkspaceSpecDocs = (
  ref: WorkspaceRef,
  files: Record<string, string>,
  provenance?: WorkspaceSpecProvenance,
): Promise<void> => getSpecStore().saveWorkspaceSpecDocs(ref, files, provenance);
export const loadWorkspaceSpecDoc = (
  workspaceOrgId: string,
  docRef: string,
  ref?: Pick<WorkspaceRef, 'scope'> & WorkspaceSpecAt,
): Promise<string | null> => getSpecStore().loadWorkspaceSpecDoc(workspaceOrgId, docRef, ref);
export const listWorkspaceSpecVersions = (
  ref: WorkspaceRef,
  artifact: WorkspaceSpecVersionArtifact,
  opts?: { limit?: number },
): Promise<WorkspaceSpecVersion[]> => getSpecStore().listWorkspaceSpecVersions(ref, artifact, opts);
export const readWorkspaceSpecVersion = (
  workspaceOrgId: string,
  artifact: WorkspaceSpecVersionArtifact,
  versionId: string,
): Promise<WorkspaceSpecVersion | null> =>
  getSpecStore().readWorkspaceSpecVersion(workspaceOrgId, artifact, versionId);
