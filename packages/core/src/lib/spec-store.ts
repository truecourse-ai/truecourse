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
import type { RepoRef } from './contract-store.js';

export type { RepoRef } from './contract-store.js';

export type SpecArtifact = 'claims' | 'decisions' | 'scanState';

/** Pluggable spec store. File-backed by default; EE injects Postgres. */
export interface SpecStore {
  /** Persist one spec JSON artifact for `(ref)`. Overwrites prior content. */
  saveSpec(ref: RepoRef, artifact: SpecArtifact, json: unknown): Promise<void>;
  /** Read one spec JSON artifact at a specific `ref`, or `null` when absent. */
  loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact): Promise<T | null>;
  /** Read the repo's CURRENT artifact (the latest stored, for the dashboard), or `null`. */
  loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact): Promise<T | null>;
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
/** Whether the active spec store reads/writes the live repo files (file) or Postgres (EE). */
export const specsMaterializeInPlace = (): boolean => active.materializesInPlace;
