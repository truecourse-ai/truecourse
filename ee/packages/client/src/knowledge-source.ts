/**
 * Workspace Knowledge client data access. Knowledge is the curated-corpus spec +
 * the `.tc` contracts derived from connected tools (Confluence, …) on sync,
 * shared by every repo in the workspace. The interactive claims/conflict surface
 * is gone (corpus path) — the page shows the generated workspace contracts and
 * the provenance ledger; (re)processing happens on a connector sync.
 */

import type { ContractsFile, ContractsTree } from '@/lib/api';
import { getJson } from './api';

const BASE = '/api/ee/knowledge';

// --- Provenance (the synced source-doc ledger) -----------------------------

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
