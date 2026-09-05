/**
 * Purge every per-repo row when a repository is disconnected. The `gh_repos`
 * link row is what scopes a repo to its workspace; every other per-repo table
 * keys on the bare repo key with no workspace column, so rows left behind
 * would be inherited wholesale by the next workspace to connect the same
 * `owner/repo`. One transaction: a partial purge must not strand data behind
 * a deleted link.
 *
 * Deliberately NOT purged: `extraction_cache` (content-keyed, repo-agnostic by
 * design) and the workspace-/org-scoped stores (knowledge, traces, settings) —
 * those belong to the workspace, not the repo.
 */

import { eq, inArray, or, sql } from 'drizzle-orm';
import {
  analyses,
  analysisCurrent,
  analysisHistory,
  repoConfig,
  repoUiState,
  specSets,
  specSources,
  guardRuns,
  guardResults,
  guardScenarioSets,
  guardSetupSets,
  guardDependencyOverlays,
  decisions,
  content,
  ghInferredActions,
  ghBaselines,
  ghRuns,
  ghPrs,
  type Db,
} from '@truecourse/db';
import { contentScope } from './content-store.js';

/** Escape LIKE wildcards so a repo key containing `_` or `%` matches literally. */
const likeLiteral = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function purgeRepoData(db: Db, repoKey: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(analyses).where(eq(analyses.repoKey, repoKey));
    await tx.delete(analysisCurrent).where(eq(analysisCurrent.repoKey, repoKey));
    await tx.delete(analysisHistory).where(eq(analysisHistory.repoKey, repoKey));
    await tx.delete(repoConfig).where(eq(repoConfig.repoKey, repoKey));
    await tx.delete(repoUiState).where(eq(repoUiState.repoKey, repoKey));
    await tx.delete(specSets).where(eq(specSets.repoKey, repoKey));
    await tx.delete(specSources).where(eq(specSources.repoKey, repoKey));
    await tx.delete(guardRuns).where(eq(guardRuns.repoKey, repoKey));
    await tx.delete(guardResults).where(eq(guardResults.repoKey, repoKey));
    await tx.delete(guardScenarioSets).where(eq(guardScenarioSets.repoKey, repoKey));
    await tx.delete(guardSetupSets).where(eq(guardSetupSets.repoKey, repoKey));
    await tx.delete(guardDependencyOverlays).where(eq(guardDependencyOverlays.repoKey, repoKey));
    // The decisions ledger: the repo row, its PR overlays, and the guard scopes.
    await tx.delete(decisions).where(
      or(
        eq(decisions.scope, repoKey),
        eq(decisions.scope, `guard:${repoKey}`),
        sql`${decisions.scope} LIKE ${`${likeLiteral(repoKey)}#pr/%`}`,
        sql`${decisions.scope} LIKE ${`guard:${likeLiteral(repoKey)}#pr/%`}`,
      ),
    );
    // Content-addressed bodies the manifests above pointed into.
    await tx.delete(content).where(
      inArray(content.scope, [
        contentScope.spec(repoKey),
        contentScope.guard(repoKey),
        contentScope.guardEvidence(repoKey),
      ]),
    );
    // Gate-side per-repo state (unlinkRepo itself only drops the gh_repos row).
    await tx.delete(ghInferredActions).where(eq(ghInferredActions.repoFullName, repoKey));
    await tx.delete(ghBaselines).where(eq(ghBaselines.repoFullName, repoKey));
    await tx.delete(ghRuns).where(eq(ghRuns.repoFullName, repoKey));
    await tx.delete(ghPrs).where(eq(ghPrs.repoFullName, repoKey));
  });
}
