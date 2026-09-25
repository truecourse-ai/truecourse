/**
 * Purge every per-repo row when a repository is disconnected. The `repositories`
 * link row is what scopes a repo to its workspace; every other per-repo table
 * keys on the bare repo key with no workspace column, so rows left behind
 * would be inherited wholesale by the next workspace to connect the same
 * `owner/repo`. One transaction: a partial purge must not strand data behind
 * a deleted link.
 *
 * Deliberately NOT purged: `extraction_cache` (content-keyed, repo-agnostic by
 * design) and the workspace-/org-scoped stores — those belong to the workspace,
 * not the repo.
 *
 * CONTEXT is workspace state too, so this purge only drops the repository's own
 * LINKS (`context_bindings`), never a source another repository still reads. The
 * repository's own Repository source is removed by the disconnect hook
 * (`removeRepositoryContext`), which checks the remaining readers first — a
 * source is not the repository's to delete just because it was its own. The
 * content scopes dropped below are the repository's alone; the workspace's own
 * pools (`spec:ws:<org>`, `context:ws:<org>`) are never named here.
 */

import { eq, inArray, like } from 'drizzle-orm';
import {
  activityRuns,
  contextBindings,
  guardRuns,
  guardResults,
  guardScenarioSets,
  guardSetupSets,
  guardDependencyOverlays,
  decisions,
  content,
  pullRequests,
  pullRequestChecks,
  workspaceSpecSets,
  type Db,
} from '@truecourse/db';
import { pullRequestWorkspaceScopePrefix } from '@truecourse/shared';
import { contentScope } from './content-store.js';
import { touchContextWorkspace } from './context-store.js';

/** A string as a LIKE pattern matching itself alone: `%`, `_` and `\` escaped. */
const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function purgeRepoData(db: Db, repoKey: string): Promise<void> {
  // The workspaces whose Context this purge changed — stamped after the
  // transaction so their corpus reads as stale even if the disconnect hook
  // never ran.
  let touched: string[] = [];
  await db.transaction(async (tx) => {
    await tx.delete(activityRuns).where(eq(activityRuns.repoKey, repoKey));
    // Only the LINKS: the sources themselves belong to the workspace, and one
    // another repository still reads must survive this disconnect.
    const unlinked = await tx
      .delete(contextBindings)
      .where(eq(contextBindings.repoFullName, repoKey))
      .returning({ workspaceOrgId: contextBindings.workspaceOrgId });
    touched = [...new Set(unlinked.map((row) => row.workspaceOrgId))];
    await tx.delete(guardRuns).where(eq(guardRuns.repoKey, repoKey));
    await tx.delete(guardResults).where(eq(guardResults.repoKey, repoKey));
    await tx.delete(guardScenarioSets).where(eq(guardScenarioSets.repoKey, repoKey));
    await tx.delete(guardSetupSets).where(eq(guardSetupSets.repoKey, repoKey));
    await tx.delete(guardDependencyOverlays).where(eq(guardDependencyOverlays.repoKey, repoKey));
    // Its pull requests and their checks, and the corpora its checks scanned
    // into the workspace's series under the repository's pull request scopes.
    // The guard tables above go by repo key, which covers every scope.
    await tx.delete(pullRequestChecks).where(eq(pullRequestChecks.repoFullName, repoKey));
    await tx.delete(pullRequests).where(eq(pullRequests.repoFullName, repoKey));
    await tx
      .delete(workspaceSpecSets)
      .where(like(workspaceSpecSets.scope, `${likeLiteral(pullRequestWorkspaceScopePrefix(repoKey))}%`));
    // The decisions ledger: the repo's guard row (the spec decisions it reads
    // are the workspace's and survive a disconnect).
    await tx.delete(decisions).where(eq(decisions.scope, `guard:${repoKey}`));
    // Content-addressed bodies the manifests above pointed into.
    await tx.delete(content).where(
      inArray(content.scope, [
        contentScope.guard(repoKey),
        contentScope.guardEvidence(repoKey),
      ]),
    );
  });
  for (const org of touched) await touchContextWorkspace(db, org);
}
