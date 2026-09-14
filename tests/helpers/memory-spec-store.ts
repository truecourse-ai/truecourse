/**
 * The hosted spec store, in memory — the whole `SpecStore` contract without a
 * database: per-commit artifacts, the always-latest read, the per-repository
 * document snapshot, and the WORKSPACE scope the Document scan writes (the
 * corpus, the decisions, and the documents as the scan read them).
 */

import {
  setSpecStore as setSpecStoreByPackage,
  resetSpecStore as resetSpecStoreByPackage,
  type RepoRef,
  type SpecArtifact,
  type SpecStore,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';
import {
  setSpecStore as setSpecStoreBySource,
  resetSpecStore as resetSpecStoreBySource,
} from '../../packages/core/src/lib/spec-store';

export function memorySpecStore(): SpecStore {
  const byRef = new Map<string, unknown>();
  const latest = new Map<string, unknown>();
  const workspace = new Map<string, unknown>();
  const docs = new Map<string, Record<string, string>>();
  const rk = (ref: RepoRef, a: SpecArtifact): string =>
    `${ref.repoKey}\x00${ref.commitSha}\x00${a}`;
  const lk = (repoKey: string, a: SpecArtifact): string => `${repoKey}\x00${a}`;

  return {
    async saveSpec(ref, artifact, json) {
      byRef.set(rk(ref, artifact), json);
      latest.set(lk(ref.repoKey, artifact), json);
    },
    async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact) {
      return (byRef.get(rk(ref, artifact)) as T) ?? null;
    },
    async deleteSpec(ref, artifact) {
      byRef.delete(rk(ref, artifact));
    },
    async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact) {
      return (latest.get(lk(repoKey, artifact)) as T) ?? null;
    },
    async latestCommit() {
      return null;
    },
    async saveSpecDocs(ref, files) {
      docs.set(`repo:${ref.repoKey}`, { ...(docs.get(`repo:${ref.repoKey}`) ?? {}), ...files });
    },
    async loadSpecDoc(repoKey, docRef) {
      return docs.get(`repo:${repoKey}`)?.[docRef] ?? null;
    },
    async saveWorkspaceSpec(ref, artifact, json) {
      workspace.set(`${ref.workspaceOrgId}\x00${artifact}`, json);
    },
    async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact) {
      return (workspace.get(`${ref.workspaceOrgId}\x00${artifact}`) as T) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files) {
      docs.set(`ws:${ref.workspaceOrgId}`, files);
    },
    async loadWorkspaceSpecDoc(org, docRef) {
      return docs.get(`ws:${org}`)?.[docRef] ?? null;
    },
  } satisfies SpecStore;
}

/**
 * Install the in-memory spec store for a suite. Pair with {@link resetSpecStore}.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/lib/spec-store`, which resolves to the built `dist`) and the
 * source path — because under vitest those are separate module instances with
 * separate seam state.
 */
export function installMemorySpecStore(): SpecStore {
  const store = memorySpecStore();
  setSpecStoreByPackage(store);
  setSpecStoreBySource(store);
  return store;
}

export function resetSpecStore(): void {
  resetSpecStoreByPackage();
  resetSpecStoreBySource();
}
