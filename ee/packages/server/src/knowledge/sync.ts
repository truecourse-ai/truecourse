/**
 * The generic sync engine, split into the two stages the Knowledge page drives:
 *
 *   - **Sync (per connector)** — the ONLY stage that talks to a source. `list()`
 *     it, fetch every current doc (batched through `fetchMany` when the connector
 *     offers it, else one `fetch()` per ref), then PERSIST: each body is
 *     content-addressed into the shared `content` table (sha = its `contentHash`,
 *     so identical bodies dedup), and the provenance ledger is reconciled for this
 *     source (upsert present docs, prune removed ones). Sources therefore fills the
 *     moment a sync completes. The pending record's `delta` is counted against the
 *     ledger BEFORE the upsert. See {@link syncSource}.
 *   - **Process (workspace union)** — NO connector I/O. Load every ledger row + its
 *     stored body, re-consolidate the FULL union via `syncWorkspaceCorpusInProcess`
 *     (the corpus path: materialize the docs into a transient scratch tree, curate
 *     the corpus, persist it under workspace scope, delete the tree). The ledger IS
 *     the union; pruning already happened at Sync time. See
 *     {@link processWorkspaceKnowledge}.
 *
 * Whole-set is intentional: the corpus sync always re-consolidates the full doc
 * array, and the per-doc / per-slice caches make unchanged pages cost ZERO LLM
 * (same `docPath`+text → same block id → cache hit). So Process re-curates every
 * doc each run but never re-extracts unchanged ones. `version`/`contentHash` are
 * for the ledger / UI only — do NOT diff on them to skip fetching at Sync time, or
 * the full-replace reconcile would wrongly prune docs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  syncWorkspaceCorpusInProcess,
  type DecisionsFile,
  type WorkspaceDocInput,
} from '@truecourse/core/commands/spec-in-process';
import { estimateScanTokens } from '@truecourse/core/services/llm/spec-estimate';
import { getModelPrices } from '@truecourse/core/services/llm/model-prices';
import type { LlmEstimate } from '@truecourse/core/commands/analyze-core';
import type { StepTracker } from '@truecourse/core/progress';
import { sha256, type PgKnowledgeStore } from '@truecourse/ee-data-store';
import type { ConnectorConfig, DocContent, DocRef, KnowledgeConnector } from './connectors/types.js';

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

/** Build the sync record for one listed ref + its fetched body (content hash + namespaced doc path).
 *  The `contentHash` doubles as the body's content-address sha (same `sha256-<hex>`
 *  form the content store uses), so persisting the body dedups by content. */
function toSyncDoc(kind: string, ref: DocRef, content: DocContent): SyncDoc {
  return {
    externalId: ref.id,
    title: content.title || ref.title,
    url: ref.url,
    version: ref.version ?? null,
    contentHash: sha256(Buffer.from(content.markdown, 'utf-8')),
    doc: {
      docPath: connectorDocPath(kind, ref.id),
      markdown: content.markdown,
      lastTouched: ref.updatedAt,
    },
  };
}

/**
 * Fetch every ref's body from the source and build its `SyncDoc` (the caller then
 * persists them). Prefers the connector's batched `fetchMany` (one call per
 * `fetchBatchLimit` ids), falling back to a per-ref `fetch` loop for connectors
 * that don't implement it. Refs absent from a `fetchMany` result (deleted upstream
 * mid-sweep) are skipped — the reconcile then prunes their ledger rows.
 * `onProgress(done, total)` advances per fetched doc (per-ref path) or per chunk
 * (batched path).
 */
async function fetchSyncDocs<Cfg extends ConnectorConfig>(
  connector: KnowledgeConnector<Cfg>,
  cfg: Cfg,
  refs: DocRef[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<SyncDoc[]> {
  const total = refs.length;
  const docs: SyncDoc[] = [];
  if (connector.fetchMany && connector.fetchBatchLimit) {
    const limit = connector.fetchBatchLimit;
    for (let i = 0; i < refs.length; i += limit) {
      const chunk = refs.slice(i, i + limit);
      const bodies = await connector.fetchMany(cfg, chunk.map((r) => r.id));
      for (const ref of chunk) {
        const content = bodies.get(ref.id);
        if (!content) continue; // deleted upstream mid-sweep → reconcile prunes it
        docs.push(toSyncDoc(connector.kind, ref, content));
      }
      await onProgress?.(Math.min(i + limit, total), total);
    }
  } else {
    for (const ref of refs) {
      const content = await connector.fetch(cfg, ref.id);
      docs.push(toSyncDoc(connector.kind, ref, content));
      await onProgress?.(docs.length, total);
    }
  }
  return docs;
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
export const SYNC_MSG_CONSOLIDATE = 'Consolidating specs…';

/**
 * Reconcile ONE source's slice of the provenance ledger against its just-fetched
 * doc set: prune the source's rows no longer present upstream (deletion pruning
 * stays per-source correct — a Confluence sync never touches Jira's rows), then
 * upsert every present doc. The corpus consolidation is done separately (once,
 * over the union), so this is ledger bookkeeping only.
 */
async function reconcileLedgerSlice(
  org: string,
  knowledge: PgKnowledgeStore,
  sourceKind: string,
  docs: SyncDoc[],
): Promise<void> {
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

/**
 * Persist a source's just-fetched docs (the Sync stage's write half): content-
 * address every body under the org's knowledge scope (sha = its `contentHash`, so
 * identical bodies dedup), reconcile THIS source's ledger slice (upsert present,
 * prune removed), then GC any stored body no live ledger row of the org still
 * references — the prune, or a doc's content edit, can orphan the old body. Sources
 * fills the moment this returns.
 */
async function persistSyncedSource(
  org: string,
  knowledge: PgKnowledgeStore,
  sourceKind: string,
  docs: SyncDoc[],
): Promise<void> {
  for (const d of docs) await knowledge.putDocBody(org, d.contentHash, d.doc.markdown);
  await reconcileLedgerSlice(org, knowledge, sourceKind, docs);
  // Mark: every contentHash any surviving ledger row (all sources) still points at.
  const live = new Set((await knowledge.listDocuments(org)).map((r) => r.contentHash));
  await knowledge.gcDocBodies(org, live);
}

export interface ProcessOptions extends SyncOptions {
  /** Workspace curation decisions, folded into curate (force excludes/includes, verdicts, relations). */
  decisions?: DecisionsFile;
}

/**
 * Process the workspace Knowledge as the UNION of every synced source — NO
 * connector I/O. Load every ledger row + its stored body (Sync already fetched,
 * hashed, and persisted them), then consolidate the combined set into ONE corpus
 * (so a cross-source conflict — a Jira ticket vs a Confluence ADR — can be paired,
 * and one source's re-process never wipes another's corpus). The ledger IS the
 * union and deletion pruning already ran at Sync time, so this is consolidation
 * only. Unchanged docs are cache hits, so re-processing after a small delta costs
 * ~the delta. Returns the total processed count + a per-source breakdown.
 */
export async function processWorkspaceKnowledge(
  org: string,
  knowledge: PgKnowledgeStore,
  opts: ProcessOptions = {},
): Promise<{ synced: number; bySource: Record<string, number> }> {
  const progress = opts.onProgress;
  const rows = await knowledge.listDocuments(org);
  const total = rows.length;
  await progress?.(0, total, SYNC_MSG_FETCH);

  // Load each ledger row's stored body → WorkspaceDocInput. A row whose body is
  // somehow absent is skipped (idempotent syncs converge; never fail the whole
  // union on one gap). Doc path + newest-wins timestamp ride from the ledger row.
  const docs: WorkspaceDocInput[] = [];
  const bySource: Record<string, number> = {};
  let loaded = 0;
  for (const row of rows) {
    const markdown = await knowledge.getDocBody(org, row.contentHash);
    loaded += 1;
    await progress?.(loaded, total, SYNC_MSG_FETCH);
    if (markdown == null) continue;
    docs.push({ docPath: row.docPath, markdown, lastTouched: row.lastSyncedAt });
    bySource[row.sourceKind] = (bySource[row.sourceKind] ?? 0) + 1;
  }
  await progress?.(total, total, SYNC_MSG_CONSOLIDATE);

  // Consolidate the UNION once. Doc paths are connector-namespaced
  // (`knowledge/<kind>/<id>.md`), so sources never collide in the tree.
  await syncWorkspaceCorpusInProcess({
    workspaceOrgId: org,
    docs,
    decisions: opts.decisions,
    tracker: opts.tracker,
  });

  return { synced: docs.length, bySource };
}

// --- Sync ("Sync now"): fetch + persist + price (no LLM) -------------

/**
 * Ledger delta for a sync, counted by CONTENT HASH (not the source's version /
 * `updatedAt`): a doc whose upstream timestamp bumped but whose body is unchanged
 * is a cache hit, not a change. `total` is the current doc count.
 */
export interface SyncDelta {
  /** Docs not yet in the provenance ledger. */
  new: number;
  /** Docs in the ledger whose content hash differs. */
  changed: number;
  /** Ledger docs no longer present upstream (pruned on the sync). */
  removed: number;
  /** Current doc count (new + unchanged + changed). */
  total: number;
}

/**
 * A workspace sync's pre-flight estimate: the same `LlmEstimate` shape the OSS
 * scan modal renders (the scan stages), plus the ledger `delta`. A `stages`-empty
 * estimate means no LLM cost — the client skips the confirm modal but still runs
 * the sync (a removed-only delta must prune derived claims).
 */
export interface WorkspaceSyncEstimate extends LlmEstimate {
  delta: SyncDelta;
}

/** Count new / changed / removed docs for this source against the provenance ledger (content-hash exact). */
async function deltaAgainstLedger(
  org: string,
  knowledge: PgKnowledgeStore,
  sourceKind: string,
  docs: SyncDoc[],
): Promise<SyncDelta> {
  const priorHash = new Map<string, string>();
  for (const row of await knowledge.listDocuments(org)) {
    if (row.sourceKind === sourceKind) priorHash.set(row.externalId, row.contentHash);
  }
  const present = new Set(docs.map((d) => d.externalId));
  let added = 0;
  let changed = 0;
  for (const d of docs) {
    const prev = priorHash.get(d.externalId);
    if (prev === undefined) added++;
    else if (prev !== d.contentHash) changed++;
  }
  let removed = 0;
  for (const id of priorHash.keys()) if (!present.has(id)) removed++;
  return { new: added, changed, removed, total: docs.length };
}

/** Roll one or more estimates into one `LlmEstimate` (summed tokens/cost, concatenated stages). */
function mergeEstimates(parts: LlmEstimate[], subjectLabel: string): LlmEstimate {
  const priced = parts.filter((p) => p.estimatedCostUsd !== undefined);
  const merged: LlmEstimate = {
    totalEstimatedTokens: parts.reduce((n, p) => n + p.totalEstimatedTokens, 0),
    tiers: [],
    stages: parts.flatMap((p) => p.stages ?? []),
    subjectLabel,
  };
  if (priced.length > 0) {
    merged.estimatedCostUsd = priced.reduce((n, p) => n + (p.estimatedCostUsd ?? 0), 0);
    merged.costSource = priced[0].costSource;
    merged.costPartial = parts.some((p) => p.costPartial);
  }
  return merged;
}

/** Short subject for the confirm copy, e.g. "3 new · 2 changed of 40 docs". */
function deltaSubject(d: SyncDelta): string {
  const parts: string[] = [];
  if (d.new > 0) parts.push(`${d.new} new`);
  if (d.changed > 0) parts.push(`${d.changed} changed`);
  if (d.removed > 0) parts.push(`${d.removed} removed`);
  const noun = `doc${d.total === 1 ? '' : 's'}`;
  if (parts.length === 0) return `${d.total} ${noun} unchanged`;
  return `${parts.join(' · ')} of ${d.total} ${noun}`;
}

export interface EstimateOptions {
  /** Fetch-sweep progress `(done, total)` — advances per fetched doc / per chunk. */
  onFetchProgress?: (done: number, total: number) => void | Promise<void>;
}

/**
 * "Sync now" — the ONLY stage that talks to a source. Sweep it (list + fetch,
 * preferring `fetchMany`), count the ledger `delta` BEFORE any write, then PERSIST:
 * every body content-addressed into the store + the ledger reconciled for this
 * source (upsert present, prune removed, GC orphaned bodies) — so Sources fills
 * immediately and Process needs no connector. Finally price the classify +
 * consolidate stage BEFORE it runs by running the cache-aware estimators against a
 * transient scratch tree of the fetched docs — the same `LlmEstimate` the OSS scan
 * modal renders, plus the `delta`. Unchanged docs are cache hits (zero cost); the
 * content-hash delta is exact, so a doc whose `updatedAt` bumped without a body
 * change doesn't inflate it. The delta is counted before the upsert, so a re-sync
 * of unchanged docs still reports "unchanged".
 */
export async function syncSource<Cfg extends ConnectorConfig>(
  org: string,
  knowledge: PgKnowledgeStore,
  connector: KnowledgeConnector<Cfg>,
  cfg: Cfg,
  opts: EstimateOptions = {},
): Promise<WorkspaceSyncEstimate> {
  const refs = await connector.list(cfg);
  const docs = await fetchSyncDocs(connector, cfg, refs, opts.onFetchProgress);
  const delta = await deltaAgainstLedger(org, knowledge, connector.kind, docs);
  // Persist bodies + reconcile the ledger AFTER the delta read (delta is vs the
  // pre-upsert ledger). Sources reflects this sync the moment it returns.
  await persistSyncedSource(org, knowledge, connector.kind, docs);

  const prices = await getModelPrices();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ws-estimate-'));
  try {
    // Materialize the fetched docs into the same scratch layout Process uses, so
    // the estimators discover exactly the doc set Process will consolidate.
    for (const d of docs) {
      const dest = path.join(tmp, d.doc.docPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, d.doc.markdown, 'utf-8');
    }
    // The scratch tree has no git history — skip the per-doc git-mtime lookup.
    const scan = await estimateScanTokens(tmp, prices, { skipGit: true });
    const merged = mergeEstimates([scan], deltaSubject(delta));
    // A non-empty delta auto-chains scenario (guard) generation after the scan,
    // which this estimate doesn't price — so the shown cost is a partial total,
    // not a ceiling. Surface that.
    if (delta.new + delta.changed > 0) {
      merged.costPartial = true;
    }
    return { ...merged, delta };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
