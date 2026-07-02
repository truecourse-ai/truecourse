/**
 * The generic sync engine: drive any `KnowledgeConnector` into the workspace
 * Knowledge pipeline. `list()` the source, `fetch()` every current doc
 * transiently (bodies in RAM only), re-consolidate the FULL set via the
 * in-memory `scanWorkspaceInProcess`, then reconcile the provenance ledger for
 * this source (upsert present docs, prune removed ones).
 *
 * Whole-set is intentional: `scanWorkspaceInProcess` always re-consolidates the
 * full doc array, and the Postgres extraction cache makes unchanged pages cost
 * ZERO LLM (same `docPath`+text → same block id → cache hit). So we fetch every
 * page each run but never re-extract unchanged ones. `version`/`contentHash` are
 * for the ledger / UI only — do NOT diff on them to skip fetching, or the
 * full-replace reconcile would wrongly prune docs.
 */

import { createHash } from 'node:crypto';
import {
  syncWorkspaceCorpusInProcess,
  type WorkspaceDocInput,
} from '@truecourse/core/commands/spec-in-process';
import type { StepTracker } from '@truecourse/core/progress';
import type { PgKnowledgeStore } from '@truecourse/ee-data-store';
import type { ConnectorConfig, KnowledgeConnector } from './connectors/types.js';

/** Stable, namespaced path per source doc — seeds the slicer's block id. */
export function connectorDocPath(kind: string, externalId: string): string {
  return `knowledge/${kind}/${externalId}.md`;
}

export interface SyncDoc {
  externalId: string;
  title: string;
  url: string | null;
  version: string | null;
  contentHash: string;
  doc: WorkspaceDocInput;
}

/**
 * Progress callback for a long sync — `(current, total, message)`. Total is the
 * doc count; current advances per fetched doc, then sits at total during
 * consolidation. Optional, so the inline (non-job) callers are unaffected.
 */
export type SyncProgress = (current: number, total: number, message: string) => void | Promise<void>;

export interface SyncOptions {
  onProgress?: SyncProgress;
  /** Spec-scan tracker (driven through SCAN_STEPS) — the job popup's consolidate detail. */
  tracker?: StepTracker;
  /** Per-slice contract progress — the consolidate step's "N/M slices". */
  onSliceProgress?: (done: number, total: number) => void;
  /** Repair-pass progress — the consolidate step's "repairing N/M". */
  onRepairProgress?: (done: number, total: number) => void;
}

/** Stable phase messages (shared with the worker, which maps them to steps). */
export const SYNC_MSG_FETCH = 'Fetching documents…';
export const SYNC_MSG_CONSOLIDATE = 'Consolidating specs & contracts…';

/**
 * Re-consolidate the full submitted set, then reconcile THIS source's slice of
 * the provenance ledger. Shared by every connector (and any future source).
 */
export async function consolidateAndReconcile(
  org: string,
  knowledge: PgKnowledgeStore,
  sourceKind: string,
  docs: SyncDoc[],
  progress: {
    tracker?: StepTracker;
    onSliceProgress?: (done: number, total: number) => void;
    onRepairProgress?: (done: number, total: number) => void;
  } = {},
): Promise<void> {
  // Curate the synced docs into a workspace corpus and generate the `.tc`
  // contracts (corpus path), persisted under workspace scope. So a repo's
  // EFFECTIVE contracts reflect this sync. Unchanged docs hit the per-doc /
  // per-slice caches → ~0 LLM on re-sync.
  await syncWorkspaceCorpusInProcess({
    workspaceOrgId: org,
    docs: docs.map((d) => d.doc),
    tracker: progress.tracker,
  });

  const present = new Set(docs.map((d) => d.externalId));
  const existing = await knowledge.listDocuments(org);
  for (const row of existing) {
    if (row.sourceKind === sourceKind && !present.has(row.externalId)) {
      await knowledge.deleteDocument(org, sourceKind, row.externalId);
    }
  }
  for (const d of docs) {
    await knowledge.upsertDocument({
      workspaceOrgId: org,
      sourceKind,
      externalId: d.externalId,
      docPath: d.doc.docPath,
      title: d.title,
      url: d.url,
      version: d.version,
      contentHash: d.contentHash,
    });
  }
}

/** Run a connector sync end-to-end. `opts.onProgress` (job runs) reports per-doc progress. */
export async function syncWorkspaceKnowledge<Cfg extends ConnectorConfig>(
  org: string,
  knowledge: PgKnowledgeStore,
  connector: KnowledgeConnector<Cfg>,
  cfg: Cfg,
  opts: SyncOptions = {},
): Promise<{ synced: number }> {
  const progress = opts.onProgress;
  const refs = await connector.list(cfg);
  const total = refs.length;
  // Stable phase labels (no per-doc title) so the progress toast doesn't churn.
  await progress?.(0, total, SYNC_MSG_FETCH);
  const docs: SyncDoc[] = [];
  for (const ref of refs) {
    const content = await connector.fetch(cfg, ref.id); // transient body (RAM)
    const contentHash = createHash('sha256').update(content.markdown).digest('hex');
    docs.push({
      externalId: ref.id,
      title: content.title || ref.title,
      url: ref.url,
      version: ref.version ?? null,
      contentHash,
      doc: {
        docPath: connectorDocPath(connector.kind, ref.id),
        markdown: content.markdown,
        lastTouched: ref.updatedAt,
      },
    });
    await progress?.(docs.length, total, SYNC_MSG_FETCH);
  }
  await progress?.(total, total, SYNC_MSG_CONSOLIDATE);
  await consolidateAndReconcile(org, knowledge, connector.kind, docs, {
    tracker: opts.tracker,
    onSliceProgress: opts.onSliceProgress,
    onRepairProgress: opts.onRepairProgress,
  });
  return { synced: docs.length };
}
