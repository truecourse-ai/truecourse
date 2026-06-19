/**
 * Workspace `SpecDataSource` — the storage seam for the Knowledge page. Same
 * interface the repo Spec views use (`@/components/spec/SpecContext`), pointed at
 * `/api/ee/knowledge/*` instead of `/api/repos/:id/spec/*`. The decision writes
 * re-merge server-side, so `refresh()` just re-reads the persisted scan-state
 * (there's no on-demand rescan — `supportsRescan` is false; you re-upload).
 */

import type { SpecDataSource } from '@/components/spec/SpecContext';
import type {
  CanonicalSpecSection,
  CanonicalSpecTree,
  ContractsFile,
  ContractsTree,
  SpecScanResponse,
} from '@/lib/api';
import { getJson, getJsonAllow404, postJson, delJson } from './api';

const BASE = '/api/ee/knowledge';

export function createWorkspaceSpecDataSource(): SpecDataSource {
  const readScanState = () => getJsonAllow404<SpecScanResponse>(`${BASE}/scan-state`);
  return {
    supportsRescan: false,
    hydrate: readScanState,
    refresh: readScanState, // server already re-merged on the write; just re-read
    postDecision: (input) => postJson(`${BASE}/decisions`, input).then(() => undefined),
    acceptAllDefaults: () =>
      postJson(`${BASE}/decisions/batch`, { mode: 'all-defaults' }).then(() => undefined),
    revokeDecision: (conflictId) =>
      delJson(`${BASE}/decisions/${encodeURIComponent(conflictId)}`).then(() => undefined),
    markSuperseded: (older, newer, note) =>
      postJson(`${BASE}/chains/manual`, { older, newer, note }).then(() => undefined),
    includeDoc: (docPath) =>
      postJson(`${BASE}/docs/include`, { path: docPath }).then(() => undefined),
    loadCanonicalTree: () => getJson<CanonicalSpecTree>(`${BASE}/canonical/tree`),
    loadCanonicalSection: (moduleName, topic) => {
      const q = new URLSearchParams({ module: moduleName, topic });
      return getJson<CanonicalSpecSection>(`${BASE}/canonical/section?${q.toString()}`);
    },
    // Map each connector doc's stable `docPath` → its human title + source link,
    // so the Spec views show titles (not the `knowledge/<kind>/<id>.md` ids).
    loadDocLabels: async () => {
      const docs = await listKnowledgeDocuments();
      const map: Record<string, { title: string; url?: string }> = {};
      for (const d of docs) map[d.docPath] = { title: d.title, url: d.url ?? undefined };
      return map;
    },
  };
}

// --- Provenance (Knowledge-specific, not part of SpecDataSource) -----

export interface KnowledgeDocRow {
  workspaceOrgId: string;
  sourceKind: string;
  externalId: string;
  docPath: string;
  title: string;
  url: string | null;
  version: string | null;
  contentHash: string;
  lastSyncedAt: string;
}

export const listKnowledgeDocuments = () =>
  getJson<{ documents: KnowledgeDocRow[] }>(`${BASE}/documents`).then((r) => r.documents);

// --- Workspace contracts (the `.tc` corpus generated on sync) ---------------
// Same shapes as the repo `/contracts/*` routes, so the reused ContractsPanel +
// CodeViewer render them unchanged. Always-latest (no commit / ref dimension).

export const getWorkspaceContractsTree = () =>
  getJson<ContractsTree>(`${BASE}/contracts/tree`);

export const getWorkspaceContractsFile = (path: string) =>
  getJson<ContractsFile>(`${BASE}/contracts/file?path=${encodeURIComponent(path)}`);
