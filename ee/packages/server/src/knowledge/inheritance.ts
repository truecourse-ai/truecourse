/**
 * The enterprise side of repo Knowledge inheritance — the resolvers behind two core
 * seams a hosted repo's spec pipeline calls (see EE_REPO_INHERITANCE_PLAN.md):
 *
 *   - `spec-inheritance-hook` — before a repo's curate/generate, the scan pipeline
 *     asks for its workspace layer: every workspace ledger doc's STORED body (at its
 *     namespaced `knowledge/<kind>/<id>.md` path) plus the workspace decisions. The
 *     pipeline materializes the bodies into the checkout and folds the decisions
 *     under the repo's own (repo wins). No connector I/O — Sync already persisted the
 *     bodies content-addressed in Postgres.
 *   - `knowledge-ledger-reader` — the repo corpus GET enriches inherited docs (refs
 *     that start `knowledge/`) with the ledger's human title + source URL for display.
 *
 * Both resolve the repo's workspace org from the stored gate records; a repo not
 * connected to a workspace (or whose workspace has no Knowledge) inherits nothing.
 */

import type { GateStore } from '@truecourse/ee-github-app';
import { PgKnowledgeStore } from '@truecourse/ee-data-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import type {
  SpecInheritanceHook,
  WorkspaceInheritanceDoc,
} from '@truecourse/core/lib/spec-inheritance-hook';
import type {
  KnowledgeLedgerReader,
  KnowledgeDocBodyReader,
} from '@truecourse/core/lib/knowledge-ledger-reader';

export interface InheritanceDeps {
  /** Resolves a connected repo's workspace org from the stored gate records. */
  store: Pick<GateStore, 'getRepo'>;
  /** The provenance ledger + content-addressed bodies for the workspace. */
  knowledge: PgKnowledgeStore;
}

/**
 * Build the `repoKey → workspace layer` resolver installed via
 * `setSpecInheritanceHook`. Loads every workspace ledger doc's stored body + the
 * workspace decisions; returns null when the repo isn't connected to a workspace or
 * the workspace has no Knowledge (the caller then curates the repo's own docs alone).
 */
export function createSpecInheritanceHook(deps: InheritanceDeps): SpecInheritanceHook {
  return async (repoKey) => {
    const link = await deps.store.getRepo(repoKey);
    if (!link?.workspaceOrgId) return null;
    const org = link.workspaceOrgId;

    const rows = await deps.knowledge.listDocuments(org);
    if (rows.length === 0) return null;

    const docs: WorkspaceInheritanceDoc[] = [];
    for (const row of rows) {
      const markdown = await deps.knowledge.getDocBody(org, row.contentHash);
      if (markdown == null) continue; // a body somehow absent → skip it, not the whole layer
      docs.push({ docPath: row.docPath, markdown, lastTouched: row.externalUpdatedAt ?? undefined });
    }
    if (docs.length === 0) return null;

    return { docs, decisions: await getWorkspaceDecisions(org) };
  };
}

/**
 * Build the `(repoKey, docPaths) → title/url` reader installed via
 * `setKnowledgeLedgerReader`. One batched ledger query for the workspace the repo
 * belongs to; an empty map when the repo isn't connected to a workspace.
 */
export function createKnowledgeLedgerReader(deps: InheritanceDeps): KnowledgeLedgerReader {
  return async (repoKey, docPaths) => {
    if (docPaths.length === 0) return new Map();
    const link = await deps.store.getRepo(repoKey);
    if (!link?.workspaceOrgId) return new Map();
    return deps.knowledge.titlesByDocPath(link.workspaceOrgId, docPaths);
  };
}

/**
 * Build the `(repoKey, docPath) → stored body` reader installed via
 * `setKnowledgeDocBodyReader`. Resolves the repo's workspace org from the gate
 * records, then reads the inherited doc's STORED body from its ledger row's content
 * hash (no connector I/O — Sync already persisted it). Null when the repo has no
 * workspace, no ledger row for the path, or the body is absent; the repo Spec-tab
 * doc route renders any of those as a 404.
 */
export function createKnowledgeDocBodyReader(deps: InheritanceDeps): KnowledgeDocBodyReader {
  return async (repoKey, docPath) => {
    const link = await deps.store.getRepo(repoKey);
    if (!link?.workspaceOrgId) return null;
    const org = link.workspaceOrgId;
    const row = await deps.knowledge.findByDocPath(org, docPath);
    if (!row) return null;
    return deps.knowledge.getDocBody(org, row.contentHash);
  };
}
