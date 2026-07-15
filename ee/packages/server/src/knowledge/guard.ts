/**
 * Workspace guard generation — the shared doc-fetch behind the Scenarios tab's
 * estimate + generate. Generation's doc universe is the workspace corpus's KEPT
 * docs (relevance-filtered, bounded — never the raw source of thousands of
 * tickets), read from the STORED bodies via the provenance ledger (corpus ref =
 * docPath → ledger row → content-addressed body). No connector I/O — Sync already
 * persisted them, so this works even for docs whose source was disconnected after
 * sync. This module has no jobs dependency so both the guard routes (estimate) and
 * the worker (generate job) can import it.
 */

import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import type { CuratedCorpus, WorkspaceDocInput } from '@truecourse/core/commands/spec-in-process';
import type { PgKnowledgeStore } from '@truecourse/ee-data-store';

export interface GuardDocFetchDeps {
  knowledge: PgKnowledgeStore;
}

/**
 * Read the corpus's KEPT docs' stored bodies via the provenance ledger. A doc with
 * no ledger row, or whose stored body is somehow absent, is skipped (best-effort —
 * its section simply can't be extracted this run). Shared by the estimate route and
 * the generate job so both see the same doc universe.
 */
export async function fetchWorkspaceGuardDocs(deps: GuardDocFetchDeps, org: string): Promise<WorkspaceDocInput[]> {
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
  if (!corpus) return [];

  const docs: WorkspaceDocInput[] = [];
  for (const cdoc of corpus.docs) {
    const row = await deps.knowledge.findByDocPath(org, cdoc.ref);
    if (!row) continue;
    const markdown = await deps.knowledge.getDocBody(org, row.contentHash);
    if (markdown == null) continue;
    docs.push({ docPath: cdoc.ref, markdown, lastTouched: cdoc.lastTouched });
  }
  return docs;
}
