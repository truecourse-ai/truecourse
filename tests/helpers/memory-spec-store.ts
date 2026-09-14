/**
 * The hosted spec store, in memory — the whole `SpecStore` contract without a
 * database: per-commit artifacts, the always-latest read, the per-repository
 * document snapshot, and the WORKSPACE scope the Document scan writes (the
 * corpus, the decisions, and the documents as the scan read them).
 */

import type {
  RepoRef,
  SpecArtifact,
  SpecStore,
  WorkspaceRef,
} from '@truecourse/core/lib/spec-store';

export function memorySpecStore(): SpecStore {
  const byRef = new Map<string, unknown>();
  const latest = new Map<string, unknown>();
  const workspace = new Map<string, unknown>();
  const docs = new Map<string, Record<string, string>>();
  const rk = (ref: RepoRef, a: SpecArtifact): string =>
    `${ref.repoKey}\x00${ref.commitSha}\x00${a}`;
  const lk = (repoKey: string, a: SpecArtifact): string => `${repoKey}\x00${a}`;

  return {
    materializesInPlace: false,
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
