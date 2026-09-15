/**
 * The spec store, in memory — the whole `SpecStore` contract without a
 * database: the WORKSPACE scope the Document scan writes (the corpus, the
 * decisions, and the documents as the scan read them).
 */

import {
  setSpecStore as setSpecStoreByPackage,
  resetSpecStore as resetSpecStoreByPackage,
  type SpecArtifact,
  type SpecStore,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';
import {
  setSpecStore as setSpecStoreBySource,
  resetSpecStore as resetSpecStoreBySource,
} from '../../packages/core/src/lib/spec-store';

export function memorySpecStore(): SpecStore {
  const workspace = new Map<string, unknown>();
  const docs = new Map<string, Record<string, string>>();

  return {
    async saveWorkspaceSpec(ref, artifact, json) {
      workspace.set(`${ref.workspaceOrgId}\x00${artifact}`, json);
    },
    async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact) {
      return (workspace.get(`${ref.workspaceOrgId}\x00${artifact}`) as T) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files) {
      docs.set(ref.workspaceOrgId, files);
    },
    async loadWorkspaceSpecDoc(org, docRef) {
      return docs.get(org)?.[docRef] ?? null;
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
