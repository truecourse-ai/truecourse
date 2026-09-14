/**
 * A repository's corpus is a SLICE of the workspace's: the curated corpus cut
 * down to the documents of the sources it is linked to. Derived on read — there
 * is no per-repository corpus stored anywhere — so every surface that asks what
 * a repository reads asks it here, and asks the workspace's one decisions
 * ledger alongside it.
 */

import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { contextBindings } from '@truecourse/core/lib/context-store';
import { sliceCorpus } from '@truecourse/core/services/context';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';

export interface RepoCorpusSlice {
  corpus: CuratedCorpus | null;
  decisions: DecisionsFile;
}

/**
 * The slice `repoKey` reads and the decisions it resolves against. A workspace
 * that has never been scanned answers with no corpus at all.
 */
export async function readRepoCorpusSlice(
  org: string,
  repoKey: string,
): Promise<RepoCorpusSlice> {
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
  const [sourceIds, decisions] = await Promise.all([
    corpus ? contextBindings(org, repoKey) : Promise.resolve([] as string[]),
    getWorkspaceDecisions(org),
  ]);
  return { corpus: corpus ? sliceCorpus(corpus, sourceIds) : null, decisions };
}
