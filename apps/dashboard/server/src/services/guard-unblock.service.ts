/**
 * Unblocking the Flow generation a conflict stopped.
 *
 * `guard generate` refuses to author scenarios against documents that disagree:
 * it stores a report whose status is `open-conflicts` and stops. The decision
 * that settles the last of those disagreements is therefore the moment that
 * generation becomes runnable again, and nothing else will notice — no scan
 * follows a decision, and the ripple only runs behind a scan.
 *
 * Decisions are the WORKSPACE's, and one of them can free SEVERAL repositories
 * at once. But a conflict only ever blocked the repositories that read both of
 * its documents, so each is judged against its OWN slice of the corpus: the
 * documents it is linked to, and no others.
 *
 * Best-effort throughout. The decision is already saved by the time this runs,
 * so a queue that will not answer is logged, never thrown at the person who
 * just made the decision.
 */

import { openConflicts } from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { readGuardResultForView } from '@truecourse/core/commands/guard-read';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import { sliceCorpus } from '@truecourse/core/services/context';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { workspaceRepositories } from './context-scan.service.js';

/**
 * ONE repository: did these decisions leave its corpus with nothing open, and
 * was its generation blocked on exactly that? Answers whether a generate was
 * enqueued. Throws only what the enqueue throws.
 *
 * The guard-store read is gated on an empty open set so the hot path (conflicts
 * still remain) never touches it. The report is the repository-level view read
 * (the baseline commit's row) — never the store's newest row, which a PR head's
 * regenerated `ok` report would shadow, silently skipping the unblock forever.
 */
export async function unblockRepoGenerate(
  repoKey: string,
  corpus: CuratedCorpus,
  decisions: DecisionsFile,
): Promise<boolean> {
  if (corpus.docs.length === 0) return false;
  if (openConflicts(corpus, decisions).length > 0) return false;
  const report = await readGuardResultForView(repoKey);
  if (report?.status !== 'open-conflicts') return false;
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return false;
  await enqueue(repoKey);
  return true;
}

/**
 * Every repository of the workspace, each against its own slice of the
 * workspace corpus. Answers the repositories whose generation was started.
 * Never throws.
 */
export async function unblockWorkspaceGenerates(org: string): Promise<string[]> {
  const started: string[] = [];
  try {
    // Nothing to enqueue through (file mode, tests) is not a walk worth taking.
    if (!getGuardGenerateEnqueue()) return started;
    const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
    if (!corpus) return started;
    const decisions = await getWorkspaceDecisions(org);
    for (const repo of await workspaceRepositories(org)) {
      const slice = sliceCorpus(corpus, repo.sourceIds);
      if (!slice) continue;
      try {
        if (await unblockRepoGenerate(repo.repoFullName, slice, decisions)) {
          started.push(repo.repoFullName);
        }
      } catch (err) {
        log.warn(
          `[context] could not start the blocked generate for ${repo.repoFullName}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    log.warn(`[context] could not look for blocked generates in ${org}: ${(err as Error).message}`);
  }
  return started;
}
