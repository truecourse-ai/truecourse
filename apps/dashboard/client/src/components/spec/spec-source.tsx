/**
 * The Spec-corpus data-source SEAM.
 *
 * `SpecCorpusView` / `SpecOverlapDetail` / `SpecDocViewer` (+ the `useSpecCorpus`
 * hook) read the corpus, one doc's markdown, and record decisions
 * (includes/excludes/conflict-resolution) through a `SpecSource` rather than
 * calling `@/lib/api` directly. The DEFAULT is the repo implementation
 * (`createRepoSpecSource`), which READS the repository — its slice of the
 * corpus, its documents — and WRITES its decisions where those reads come from:
 * the workspace. `createWorkspaceContextSource` is the same six writers over a
 * workspace-wide read.
 *
 * A component resolves its source with `useSpecSource()` (the context value) and
 * falls back to a repo source built from its `repoId` when there is no
 * provider — so existing repo callers (and their tests) need no wrapper.
 *
 * Capability flags the components vary on ride the source: `supportsScan` (repo
 * curates on demand via the header Scan button; the workspace equivalent is
 * Sync/Process on Integrations, so the workspace source hides it).
 */

import { createContext, useContext, type ReactNode } from 'react';
import * as api from '@/lib/api';
import type {
  SpecConflictAck,
  SpecCorpusResponse,
  SpecDecisionAck,
  SpecSkippedDoc,
} from '@/lib/api';

/** Paging + filter for the skipped ("Not included") listing. */
export interface SkippedQuery {
  query?: string;
  reason?: string;
  limit: number;
  offset: number;
}

/** One page of skipped docs + the total matching the filter (for the header count). */
export interface SkippedPage {
  docs: SpecSkippedDoc[];
  total: number;
}

/** The section-verdict POST payload (pick-a-side / dismissal). */
export interface ConflictResolutionPayload {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  verdict: 'a' | 'b' | 'dismissed';
  note?: string;
}

/** The verdict-DELETE payload (dispute identity: unordered pair + anchors). */
export interface DeleteConflictPayload {
  docA: string;
  anchorA: string | null;
  docB: string;
  anchorB: string | null;
}

/**
 * The ~8 data-access calls the corpus components make, plus the capability flags
 * they vary on. An include/exclude/verdict write returns the decision-list ack;
 * the caller branches on `'corpus' in res` for a source that answers with a
 * whole corpus instead.
 */
export interface SpecSource {
  /** Repo curates on demand (header Scan button + scan-oriented empty state). The
   *  workspace source sets this false — content arrives via Sync/Process. */
  supportsScan: boolean;
  /** The corpus payload, or null on 404 (never processed / no scan yet). */
  getCorpus(): Promise<SpecCorpusResponse | null>;
  /** One source doc's markdown. */
  getDoc(ref: string): Promise<{ ref: string; content: string }>;
  /**
   * A page of skipped docs. The repo source slices the `skippedDocs` array the
   * corpus payload already carries; the workspace source hits the paged endpoint
   * (its corpus payload ships only a skipped SUMMARY, for scale).
   */
  listSkipped(q: SkippedQuery): Promise<SkippedPage>;
  addInclude(ref: string): Promise<SpecCorpusResponse | SpecDecisionAck>;
  removeInclude(ref: string): Promise<SpecCorpusResponse | SpecDecisionAck>;
  addExclude(ref: string): Promise<SpecCorpusResponse | SpecDecisionAck>;
  removeExclude(ref: string): Promise<SpecCorpusResponse | SpecDecisionAck>;
  postConflictResolution(payload: ConflictResolutionPayload): Promise<SpecConflictAck | SpecCorpusResponse>;
  deleteConflictResolution(payload: DeleteConflictPayload): Promise<SpecConflictAck | SpecCorpusResponse>;
  /**
   * Start a fresh curate (repo). It runs as a background job, so this resolves
   * when the scan is QUEUED, never when it ends. A source with no on-demand
   * scan (the workspace one) does nothing.
   */
  scan(): Promise<void>;
}

/** The half of a source that RECORDS a decision, as opposed to reading one. */
export type SpecDecisionWriters = Pick<
  SpecSource,
  | 'addInclude'
  | 'removeInclude'
  | 'addExclude'
  | 'removeExclude'
  | 'postConflictResolution'
  | 'deleteConflictResolution'
>;

/**
 * The decision writers at WORKSPACE scope. Documentation belongs to the
 * workspace, so a force-include, a force-exclude and a conflict verdict are
 * settled once for every repository that reads the documents — and that ledger
 * is the one every corpus read folds, whichever repository it was read through.
 */
export const workspaceDecisionWriters: SpecDecisionWriters = {
  addInclude: (ref) => api.addContextInclude(ref),
  removeInclude: (ref) => api.removeContextInclude(ref),
  addExclude: (ref) => api.addContextExclude(ref),
  removeExclude: (ref) => api.removeContextExclude(ref),
  postConflictResolution: (payload) => api.postContextConflictResolution(payload),
  deleteConflictResolution: (payload) => api.deleteContextConflictResolution(payload),
};

/** Case-insensitive filter + slice a skipped array (the repo `listSkipped` impl). */
export function sliceSkipped(all: SpecSkippedDoc[], q: SkippedQuery): SkippedPage {
  let docs = all;
  if (q.reason) docs = docs.filter((d) => d.reason === q.reason);
  const needle = q.query?.trim().toLowerCase();
  if (needle) {
    docs = docs.filter(
      (d) => d.ref.toLowerCase().includes(needle) || d.reason.toLowerCase().includes(needle),
    );
  }
  return { docs: docs.slice(q.offset, q.offset + q.limit), total: docs.length };
}

/**
 * The default (repo) source: the corpus slice, the documents and the skipped
 * listing of ONE repository, with its decisions written at workspace scope —
 * which is the ledger `GET /spec/corpus` folds, so a decision made here is a
 * decision the next read shows. `listSkipped` slices the `skippedDocs` the last
 * corpus read returned (client-side, no extra request).
 */
export function createRepoSpecSource(repoId: string): SpecSource {
  let lastSkipped: SpecSkippedDoc[] = [];
  return {
    supportsScan: true,
    async getCorpus() {
      const r = await api.getSpecCorpus(repoId);
      lastSkipped = r?.corpus.skippedDocs ?? [];
      return r;
    },
    getDoc: (ref) => api.getSpecDoc(repoId, ref),
    async listSkipped(q) {
      return sliceSkipped(lastSkipped, q);
    },
    ...workspaceDecisionWriters,
    // Documentation is the workspace's: the one scan is the workspace Document
    // scan, whichever repository's corpus the reader was looking at.
    scan: async () => {
      await api.startContextScan();
    },
  };
}

const SpecSourceContext = createContext<SpecSource | null>(null);

/** Supply a data source (e.g. the workspace source) to the corpus components below. */
export function SpecSourceProvider({ source, children }: { source: SpecSource; children: ReactNode }) {
  return <SpecSourceContext.Provider value={source}>{children}</SpecSourceContext.Provider>;
}

/** The provided source, or null when a repo page renders the components directly. */
export function useSpecSource(): SpecSource | null {
  return useContext(SpecSourceContext);
}
