/**
 * The spec store, in memory — the whole `SpecStore` contract without a
 * database: the WORKSPACE scope the Document scan writes (the corpus and the
 * documents as the scan read them, as versioned series; the decisions as the
 * one ledger).
 */

import { DEFAULT_VERSION_SCOPE, type WorkspaceSpecVersion } from '@truecourse/shared';
import {
  setSpecStore as setSpecStoreByPackage,
  resetSpecStore as resetSpecStoreByPackage,
  type SpecArtifact,
  type SpecStore,
  type WorkspaceRef,
  type WorkspaceSpecAt,
  type WorkspaceSpecProvenance,
} from '@truecourse/core/lib/spec-store';
import {
  setSpecStore as setSpecStoreBySource,
  resetSpecStore as resetSpecStoreBySource,
} from '../../packages/core/src/lib/spec-store';

interface MemoryVersion {
  id: string;
  scope: string;
  json: unknown;
  provenance: WorkspaceSpecProvenance;
  createdAt: string;
}

export function memorySpecStore(): SpecStore {
  // Series keyed by (org, scope, artifact), oldest first; the ledger by org.
  const series = new Map<string, MemoryVersion[]>();
  const ledger = new Map<string, unknown>();
  let seq = 0;
  const key = (ref: WorkspaceRef, artifact: string): string =>
    `${ref.workspaceOrgId}\x00${ref.scope ?? DEFAULT_VERSION_SCOPE}\x00${artifact}`;
  const find = (ref: WorkspaceRef, artifact: SpecArtifact, at: WorkspaceSpecAt): MemoryVersion | undefined => {
    if (at.id) {
      for (const [k, versions] of series) {
        if (!k.startsWith(`${ref.workspaceOrgId}\x00`) || !k.endsWith(`\x00${artifact}`)) continue;
        const hit = versions.find((v) => v.id === at.id);
        if (hit) return hit;
      }
      return undefined;
    }
    return series.get(key(ref, artifact))?.at(-1);
  };

  return {
    async saveWorkspaceSpec(ref, artifact, json, provenance = {}) {
      if (artifact === 'decisions') {
        ledger.set(ref.workspaceOrgId, json);
        return;
      }
      const list = series.get(key(ref, artifact)) ?? [];
      seq += 1;
      list.push({
        id: `v${seq}`,
        scope: ref.scope ?? DEFAULT_VERSION_SCOPE,
        json,
        provenance,
        createdAt: new Date(seq * 1000).toISOString(),
      });
      series.set(key(ref, artifact), list);
    },
    async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact, at: WorkspaceSpecAt = {}) {
      if (artifact === 'decisions') return (ledger.get(ref.workspaceOrgId) as T) ?? null;
      return (find(ref, artifact, at)?.json as T) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files, provenance) {
      await this.saveWorkspaceSpec(ref, 'docs', files, provenance);
    },
    async loadWorkspaceSpecDoc(org, docRef, ref = {}) {
      const files = find({ workspaceOrgId: org, ...(ref.scope ? { scope: ref.scope } : {}) }, 'docs', ref.id ? { id: ref.id } : {})
        ?.json as Record<string, string> | undefined;
      return files?.[docRef] ?? null;
    },
    async readWorkspaceSpecVersion(org, artifact, versionId) {
      for (const [k, versions] of series) {
        if (!k.startsWith(`${org}\x00`) || !k.endsWith(`\x00${artifact}`)) continue;
        const v = versions.find((x) => x.id === versionId);
        if (v) {
          return {
            id: v.id,
            artifact,
            scope: v.scope,
            producedByRun: v.provenance.producedByRun ?? null,
            model: v.provenance.model ?? null,
            sourceCommit: v.provenance.sourceCommit ?? null,
            createdAt: v.createdAt,
          };
        }
      }
      return null;
    },
    async listWorkspaceSpecVersions(ref, artifact, opts = {}) {
      const versions: WorkspaceSpecVersion[] = (series.get(key(ref, artifact)) ?? []).map((v) => ({
        id: v.id,
        artifact,
        scope: v.scope,
        producedByRun: v.provenance.producedByRun ?? null,
        model: v.provenance.model ?? null,
        sourceCommit: v.provenance.sourceCommit ?? null,
        createdAt: v.createdAt,
      }));
      return versions.reverse().slice(0, opts.limit ?? 50);
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
